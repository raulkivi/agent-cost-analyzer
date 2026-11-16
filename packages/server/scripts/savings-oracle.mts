// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Phase 16: an independent oracle for the savings report's two hand-checked
// opportunities (docs/plans/savings-report.md §14, §4 O1 and O2). It reads the
// raw Claude Code JSONL lines and the bundled price book and vendor-profile
// JSON, and shares no code with the savings detectors, the request-trace
// builder or the cost pricer: a bug in one of those can't also be in here.
// The only library it uses is the tokenizer D12 names for per-tool estimates.
//
// Definitions, from the plan (not from the code):
//   - a request is one LLM call (one message id) on the session's active branch;
//     a turn with any request lacking complete usage is left out whole;
//   - prompt = uncached + cache read + cache write; the tokens lost at request i
//     are min(prompt(i-1), prompt(i)) - cacheRead(i);
//   - D7: a break is lost tokens >= the model's minimum cacheable tokens and
//     >= half the previous prompt; O2: same model, no compaction, and the gap
//     start-to-start longer than the cache lifetime (Claude Code asks for the
//     1-hour lifetime where the vendor documents one);
//   - O2 saving, an upper bound: lost x (the dearer of the 1-hour cache-write
//     and plain-input rate - the cache-read rate), at the break's date;
//   - O1: a tool's definition tokens are the local estimate over its
//     description plus input schema (name alone when deferred); each request
//     resends them, so the saving is tokens x requests x (cache-read rate ..
//     plain-input rate) per model, priced at the session's first request.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { countTokens } from "gpt-tokenizer/encoding/o200k_base";

export type RawLine = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const asCount = (value: unknown): number | undefined => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined);
const messageOf = (line: RawLine): Record<string, unknown> | undefined => (isRecord(line.message) ? line.message : undefined);

export function parseJsonl(text: string): RawLine[] {
  const lines: RawLine[] = [];
  for (const raw of text.split("\n")) {
    if (raw.trim() === "") continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isRecord(parsed) && typeof parsed.type === "string") lines.push(parsed);
    } catch {
      // A torn or foreign line is not data.
    }
  }
  return lines;
}

// ---------------------------------------------------------------- the branch

const parentOf = (line: RawLine): string | undefined =>
  typeof line.parentUuid === "string" ? line.parentUuid : typeof line.logicalParentUuid === "string" ? line.logicalParentUuid : undefined;

// The log is a tree (a resend forks it). The active branch ends at the leaf the
// last `last-prompt` line names, else at the file's last leaf.
export function activeBranchOf(lines: readonly RawLine[]): RawLine[] {
  const byUuid = new Map<string, RawLine>();
  for (const line of lines) if (typeof line.uuid === "string") byUuid.set(line.uuid, line);
  const parents = new Set(lines.map(parentOf).filter((id): id is string => id !== undefined));
  let leaf: string | undefined;
  for (let i = lines.length - 1; i >= 0 && leaf === undefined; i -= 1) {
    const line = lines[i]!;
    if (line.type === "last-prompt" && typeof line.leafUuid === "string") leaf = line.leafUuid;
  }
  if (leaf === undefined) leaf = lines.map((l) => l.uuid).filter((id): id is string => typeof id === "string" && !parents.has(id)).at(-1);
  const chain: RawLine[] = [];
  const seen = new Set<string>();
  for (let id = leaf; id !== undefined && !seen.has(id); ) {
    const line = byUuid.get(id);
    if (!line) break;
    seen.add(id);
    chain.push(line);
    id = parentOf(line);
  }
  return chain.reverse();
}

// ------------------------------------------------------------------ requests

export interface OracleRequest {
  index: number;
  turn: number;
  at: string;
  atMs: number;
  model: string;
  uncached: number;
  cacheRead: number;
  cacheWrite: number;
  // The first request after a compaction: the prompt was rebuilt on purpose.
  compaction: boolean;
}

const SYNTHETIC = "<synthetic>";

// A human's turn opens at a user line that is not a tool result, not meta text
// the CLI injected and not a compaction's summary.
export function opensTurn(line: RawLine): boolean {
  if (line.type !== "user" || line.isMeta === true || line.isCompactSummary === true) return false;
  const content = messageOf(line)?.content;
  if (typeof content === "string") return true;
  return Array.isArray(content) && content.some((block) => !(isRecord(block) && block.type === "tool_result"));
}

export interface Turn {
  lines: RawLine[];
}

// Lines before the first human message belong to no turn.
export function turnsOf(branch: readonly RawLine[]): Turn[] {
  const turns: Turn[] = [];
  for (const line of branch) {
    if (opensTurn(line)) turns.push({ lines: [line] });
    else turns.at(-1)?.lines.push(line);
  }
  return turns;
}

export interface Round {
  id: string;
  lines: RawLine[];
}

// One response is written as several lines (one per content block) sharing a
// message id; synthetic lines are the CLI's own, not requests.
export function roundsOf(turn: Turn): Round[] {
  const rounds = new Map<string, Round>();
  for (const line of turn.lines) {
    const id = line.type === "assistant" ? messageOf(line)?.id : undefined;
    if (typeof id !== "string") continue;
    const round = rounds.get(id) ?? { id, lines: [] };
    round.lines.push(line);
    rounds.set(id, round);
  }
  return [...rounds.values()].filter((round) => !round.lines.some((line) => messageOf(line)?.model === SYNTHETIC));
}

interface RoundFigures {
  at: string;
  model: string;
  uncached: number;
  cacheRead: number;
  cacheWrite: number;
}

function figuresOf(round: Round): RoundFigures | undefined {
  const usage = round.lines.map((line) => messageOf(line)?.usage).find(isRecord);
  const model = round.lines.map((line) => messageOf(line)?.model).find((m): m is string => typeof m === "string" && m.length > 0);
  const time = round.lines.map((line) => line.timestamp).find((t): t is string => typeof t === "string" && !Number.isNaN(Date.parse(t)));
  if (!usage || !model || !time) return undefined;
  const uncached = asCount(usage.input_tokens);
  const cacheRead = asCount(usage.cache_read_input_tokens);
  const cacheWrite = asCount(usage.cache_creation_input_tokens);
  const output = asCount(usage.output_tokens);
  if (uncached === undefined || cacheRead === undefined || cacheWrite === undefined || output === undefined) return undefined;
  return { at: new Date(time).toISOString(), model, uncached, cacheRead, cacheWrite };
}

// The first request after each compaction boundary of the branch.
function compactedRoundIds(turns: readonly Turn[]): Set<string> {
  const marked = new Set<string>();
  const seen = new Set<string>();
  let pending = false;
  for (const turn of turns) {
    const ids = new Set(roundsOf(turn).map((round) => round.id));
    for (const line of turn.lines) {
      if (line.type === "system" && line.subtype === "compact_boundary") {
        pending = true;
        continue;
      }
      const id = line.type === "assistant" ? messageOf(line)?.id : undefined;
      if (typeof id !== "string" || seen.has(id) || !ids.has(id)) continue;
      seen.add(id);
      if (pending) {
        marked.add(id);
        pending = false;
      }
    }
  }
  return marked;
}

// The session's requests in order. A turn with any request lacking its figures
// is left out whole (its chain of prompts would be broken); a compaction in a
// left-out turn is carried to the next request.
export function requestsOf(branch: readonly RawLine[]): OracleRequest[] {
  const turns = turnsOf(branch);
  const compacted = compactedRoundIds(turns);
  const requests: OracleRequest[] = [];
  let carried = false;
  turns.forEach((turn, turnIndex) => {
    const rounds = roundsOf(turn);
    if (rounds.length === 0) return;
    const figures = rounds.map(figuresOf);
    if (figures.some((f) => f === undefined)) {
      carried ||= rounds.some((round) => compacted.has(round.id));
      return;
    }
    rounds.forEach((round, i) => {
      const f = figures[i]!;
      // A line written out of order never makes a gap negative.
      const previous = requests.at(-1);
      const atMs = Math.max(Date.parse(f.at), previous?.atMs ?? Number.NEGATIVE_INFINITY);
      const compaction = carried || compacted.has(round.id);
      carried = false;
      requests.push({ index: requests.length, turn: turnIndex, at: new Date(atMs).toISOString(), atMs, model: f.model, uncached: f.uncached, cacheRead: f.cacheRead, cacheWrite: f.cacheWrite, compaction });
    });
  });
  return requests;
}

const promptOf = (request: OracleRequest): number => request.uncached + request.cacheRead + request.cacheWrite;

// ------------------------------------------------ prices and caching rules

interface Tier {
  maxInputTokens?: number;
  inputUsdPerM: number;
  cachedInputUsdPerM: number;
  cacheWriteUsdPerM: number | null;
  extendedCacheWriteUsdPerM?: number;
}
interface PriceVersion {
  id: string;
  modelId: string;
  effectiveFrom: string;
  effectiveTo?: string;
  kind?: string;
  tiers: Tier[];
}
interface Caching {
  kind: string;
  minCacheableTokens?: number;
  defaultTtlMinutes?: number;
  extendedTtlMinutes?: number;
  ttlMinutes?: { fixed?: number; min?: number; max?: number };
}
interface Profile {
  caching: Caching;
  models: Array<{ modelId: string; cachingKind?: Caching }>;
}

export interface CacheRulesOf {
  minCacheableTokens: number;
  // Claude Code's lifetime where the vendor documents a longer one it can ask for.
  ttlMinutes: number;
}

export interface ModelTables {
  priceVersion(model: string, atMs: number): PriceVersion | undefined;
  cacheRules(model: string): CacheRulesOf | undefined;
}

const allDigits = (value: string, length?: number) => value.length > 0 && (length === undefined || value.length === length) && /^\d+$/.test(value);

// The spellings a log's model id can take in the book: as written, without a
// context tag, without a release date, and with a dotted version (5-5 -> 5.5).
export function bookModelIds(logModel: string): string[] {
  let id = logModel.trim().toLowerCase();
  const out = [id];
  const add = (value: string) => {
    if (value && !out.includes(value)) out.push(value);
  };
  if (id.endsWith("]") && id.lastIndexOf("[") > 0) {
    id = id.slice(0, id.lastIndexOf("["));
    add(id);
  }
  const parts = id.split("-");
  if (parts.length > 1 && allDigits(parts.at(-1)!, 8)) id = parts.slice(0, -1).join("-");
  add(id);
  const tail = id.split("-");
  if (tail.length > 2 && allDigits(tail.at(-1)!) && allDigits(tail.at(-2)!)) add(`${tail.slice(0, -2).join("-")}-${tail.at(-2)}.${tail.at(-1)}`);
  return out;
}

const dayStart = (date: string): number => Date.parse(`${date}T00:00:00Z`);

function cachingRules(caching: Caching): CacheRulesOf | undefined {
  if (caching.minCacheableTokens === undefined) return undefined;
  if (caching.kind === "breakpoints" && caching.defaultTtlMinutes !== undefined) {
    return { minCacheableTokens: caching.minCacheableTokens, ttlMinutes: caching.extendedTtlMinutes ?? caching.defaultTtlMinutes };
  }
  return undefined;
}

// From the bundled price-book channel file and vendor-profile JSON, as parsed.
export function modelTablesFrom(input: { book: { versions: unknown[] }; profiles: unknown[] }): ModelTables {
  const versions = (input.book.versions as PriceVersion[]).filter((version) => version.kind !== "contract");
  const profileModels = new Map<string, { profile: Profile; model: Profile["models"][number] }>();
  for (const profile of input.profiles as Profile[]) {
    for (const model of profile.models) if (!profileModels.has(model.modelId.toLowerCase())) profileModels.set(model.modelId.toLowerCase(), { profile, model });
  }
  return {
    priceVersion(model, atMs) {
      for (const candidate of bookModelIds(model)) {
        const found = versions.find((v) => v.modelId.toLowerCase() === candidate && dayStart(v.effectiveFrom) <= atMs && (v.effectiveTo === undefined || atMs < dayStart(v.effectiveTo)));
        if (found) return found;
      }
      return undefined;
    },
    cacheRules(model) {
      for (const candidate of bookModelIds(model)) {
        const entry = profileModels.get(candidate);
        if (entry) return cachingRules(entry.model.cachingKind ?? entry.profile.caching);
      }
      return undefined;
    },
  };
}

// The bundled files, read as plain JSON: <fixtures>/price-book/<channel>.json
// and <fixtures>/vendor-profiles/*.json. Claude Code is priced on anthropic-api.
export function loadBundledTables(fixturesDir: string, channel = "anthropic-api"): ModelTables {
  const book = JSON.parse(readFileSync(path.join(fixturesDir, "price-book", `${channel}.json`), "utf-8")) as { versions: unknown[] };
  const profilesDir = path.join(fixturesDir, "vendor-profiles");
  const profiles = readdirSync(profilesDir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => JSON.parse(readFileSync(path.join(profilesDir, file), "utf-8")) as unknown);
  return modelTablesFrom({ book, profiles });
}

const tierFor = (version: PriceVersion, inputTokens: number): Tier =>
  version.tiers.find((tier) => tier.maxInputTokens === undefined || inputTokens <= tier.maxInputTokens) ?? version.tiers.at(-1)!;

// -------------------------------------------------------- O2: idle breaks

export type BreakCost = { known: true; low: 0; high: number; versionId: string } | { known: false; reason: string };

export interface OracleIdleBreak {
  requestIndex: number;
  turn: number;
  at: string;
  model: string;
  gapMinutes: number;
  ttlMinutes: number;
  previousPrompt: number;
  prompt: number;
  cacheRead: number;
  lostTokens: number;
  // Per million tokens, for the hand check; absent when unpriced.
  rates?: { writeUsdPerM: number; inputUsdPerM: number; cacheReadUsdPerM: number };
  cost: BreakCost;
}

function breakCost(model: string, atMs: number, lost: number, tables: ModelTables): { cost: BreakCost; rates?: OracleIdleBreak["rates"] } {
  const version = tables.priceVersion(model, atMs);
  if (!version) return { cost: { known: false, reason: `no price for ${model} on ${new Date(atMs).toISOString().slice(0, 10)}` } };
  const tier = tierFor(version, lost);
  // Writes are the 1-hour kind (Claude Code's lifetime). A version that
  // charges writes but has no 1-hour price can't say what these cost.
  if (tier.extendedCacheWriteUsdPerM === undefined && tier.cacheWriteUsdPerM !== null) return { cost: { known: false, reason: `${version.id} has no 1-hour cache-write price` } };
  const writeUsdPerM = tier.extendedCacheWriteUsdPerM ?? tier.cacheWriteUsdPerM ?? tier.inputUsdPerM;
  const dearer = Math.max(writeUsdPerM, tier.inputUsdPerM);
  const high = (lost * Math.max(0, dearer - tier.cachedInputUsdPerM)) / 1_000_000;
  return { cost: { known: true, low: 0, high, versionId: version.id }, rates: { writeUsdPerM, inputUsdPerM: tier.inputUsdPerM, cacheReadUsdPerM: tier.cachedInputUsdPerM } };
}

export function idleBreaksOf(requests: readonly OracleRequest[], tables: ModelTables): OracleIdleBreak[] {
  const found: OracleIdleBreak[] = [];
  requests.forEach((request, position) => {
    if (position === 0) return;
    const previous = requests[position - 1]!;
    const previousPrompt = promptOf(previous);
    const prompt = promptOf(request);
    const lost = Math.max(0, Math.min(previousPrompt, prompt) - request.cacheRead);
    // D7's half rule.
    if (lost === 0 || 2 * lost < previousPrompt) return;
    if (request.compaction) return;
    const rules = tables.cacheRules(request.model);
    if (!rules || lost < rules.minCacheableTokens) return;
    // A different model (or one whose rules are unknown) is a model switch, not an idle expiry.
    if (previous.model !== request.model) return;
    const gapMinutes = (request.atMs - previous.atMs) / 60_000;
    if (gapMinutes <= rules.ttlMinutes) return;
    const priced = breakCost(request.model, request.atMs, lost, tables);
    found.push({
      requestIndex: request.index,
      turn: request.turn,
      at: request.at,
      model: request.model,
      gapMinutes,
      ttlMinutes: rules.ttlMinutes,
      previousPrompt,
      prompt,
      cacheRead: request.cacheRead,
      lostTokens: lost,
      ...(priced.rates ? { rates: priced.rates } : {}),
      cost: priced.cost,
    });
  });
  return found;
}

// ----------------------------------------------------- O1: unused tools

export interface ToolSessionFacts {
  // Tool name -> estimated definition tokens, from the last main-thread request
  // shape; undefined when the log records no usable shape.
  loaded: Map<string, number> | undefined;
  // Tool names that ran on the active branch.
  invoked: Set<string>;
  requestsByModel: Map<string, number>;
  firstRequestAt: string | undefined;
}

const MAIN_THREAD = "repl_main_thread";

function definitionTokens(tool: Record<string, unknown>, name: string): number {
  if (tool.defer_loading === true) return countTokens(name);
  const description = typeof tool.description === "string" ? tool.description : "";
  const schema = tool.input_schema === undefined ? "" : JSON.stringify(tool.input_schema);
  return countTokens(description + schema);
}

function loadedToolsOf(lines: readonly RawLine[]): Map<string, number> | undefined {
  const shapes = new Map<string, Map<string, number>>();
  for (const line of lines) {
    if (line.type !== "api-request-shape" || typeof line.shapeHash !== "string" || !isRecord(line.shape) || !Array.isArray(line.shape.tools)) continue;
    const tools = new Map<string, number>();
    for (const tool of line.shape.tools) if (isRecord(tool) && typeof tool.name === "string") tools.set(tool.name, definitionTokens(tool, tool.name));
    shapes.set(line.shapeHash, tools);
  }
  const requests = lines.filter((l): l is RawLine & { shapeHash: string } => l.type === "api-request" && typeof l.shapeHash === "string" && shapes.has(l.shapeHash));
  const main = requests.filter((l) => typeof l.querySource === "string" && l.querySource.startsWith(MAIN_THREAD));
  const hash = (main.length > 0 ? main : requests).at(-1)?.shapeHash;
  return hash === undefined ? undefined : shapes.get(hash);
}

export function toolSessionFactsOf(lines: readonly RawLine[]): ToolSessionFacts {
  const branch = activeBranchOf(lines);
  const requests = requestsOf(branch);
  const invoked = new Set<string>();
  for (const turn of turnsOf(branch)) {
    for (const line of turn.lines) {
      const content = line.type === "assistant" ? messageOf(line)?.content : undefined;
      if (!Array.isArray(content)) continue;
      for (const block of content) if (isRecord(block) && block.type === "tool_use" && typeof block.name === "string") invoked.add(block.name);
    }
  }
  const requestsByModel = new Map<string, number>();
  for (const request of requests) requestsByModel.set(request.model, (requestsByModel.get(request.model) ?? 0) + 1);
  return { loaded: loadedToolsOf(lines), invoked, requestsByModel, firstRequestAt: requests[0]?.at };
}

// mcp__<server>__<tool> belongs to its server; any other name is its own group.
export function toolGroupOf(toolName: string): string {
  const folded = toolName.replace(/\s+/g, " ").trim();
  const match = /^mcp__([^_](?:.*?[^_])?)__.+$/.exec(folded);
  return match ? match[1]! : folded;
}

// D26: under an exact mcp__<server>__ group the tool part only; any other name whole.
export function toolDisplayNameOf(toolName: string): string {
  const folded = toolName.replace(/\s+/g, " ").trim();
  const match = /^mcp__(?:[^_](?:.*?[^_])?)__(.+)$/.exec(folded);
  return match ? match[1]! : folded;
}

export interface UnusedToolRow {
  // V26: each tool of the group, its tokens averaged over the sessions that loaded it (rounded).
  perTool: Array<{ rawName: string; name: string; tokens: number; sessions: number }>;
  // Sessions that loaded the group (and so enter the row), and their requests.
  sessions: number;
  requests: number;
  // The group's definition tokens in one session, averaged over the sessions, rounded.
  tokensPerSession: number;
  // True when any tool of the group ran in any given session: then it is not unused.
  ran: boolean;
  // The saving over the window: cache-read rate .. plain-input rate; only
  // sessions every model of which is priced.
  low: number;
  high: number;
  pricedSessions: number;
}

export function unusedToolRowOf(subject: string, sessions: readonly ToolSessionFacts[], tables: ModelTables): UnusedToolRow {
  let ran = false;
  const rows: Array<{ facts: ToolSessionFacts; tokens: number }> = [];
  const byTool = new Map<string, { total: number; sessions: number }>();
  for (const facts of sessions) {
    if ([...facts.invoked].some((name) => toolGroupOf(name) === subject)) ran = true;
    if (!facts.loaded) continue;
    let tokens = 0;
    let loaded = false;
    for (const [name, count] of facts.loaded) {
      if (toolGroupOf(name) !== subject) continue;
      loaded = true;
      tokens += count;
      const sum = byTool.get(name) ?? { total: 0, sessions: 0 };
      byTool.set(name, { total: sum.total + count, sessions: sum.sessions + 1 });
    }
    if (loaded) rows.push({ facts, tokens });
  }
  let low = 0;
  let high = 0;
  let pricedSessions = 0;
  for (const { facts, tokens } of rows) {
    const atMs = facts.firstRequestAt === undefined ? Number.NaN : Date.parse(facts.firstRequestAt);
    let sessionLow = 0;
    let sessionHigh = 0;
    let priced = !Number.isNaN(atMs);
    for (const [model, requests] of facts.requestsByModel) {
      const version = priced ? tables.priceVersion(model, atMs) : undefined;
      if (!version) {
        priced = false;
        break;
      }
      const tier = tierFor(version, tokens);
      sessionLow += (tokens * tier.cachedInputUsdPerM * requests) / 1_000_000;
      sessionHigh += (tokens * tier.inputUsdPerM * requests) / 1_000_000;
    }
    if (!priced) continue;
    low += sessionLow;
    high += sessionHigh;
    pricedSessions += 1;
  }
  const requests = rows.reduce((sum, { facts }) => sum + [...facts.requestsByModel.values()].reduce((a, b) => a + b, 0), 0);
  const tokensPerSession = rows.length === 0 ? 0 : Math.round(rows.reduce((sum, row) => sum + row.tokens, 0) / rows.length);
  const perTool = [...byTool].map(([rawName, { total, sessions: loadedIn }]) => ({ rawName, name: toolDisplayNameOf(rawName), tokens: Math.round(total / loadedIn), sessions: loadedIn }));
  return { perTool, sessions: rows.length, requests, tokensPerSession, ran, low, high, pricedSessions };
}

// ------------------------------------------- O1 for pi (V27, plan §7.1, §7.4)
//
// Read from pi's raw session JSONL (https://pi.dev/docs/latest/session-format):
//   - the file is a tree; every entry that is nobody's parent is a leaf and each
//     leaf is one session holding its whole root-to-leaf path (D27: a prefix a
//     later leaf shares with an earlier one is counted under the earlier one);
//   - a system message (or a compaction's `systemMessage`, or one with
//     `replace: true`, which start afresh) adds `toolsAdded` and drops
//     `toolsRemoved`; a tool's definition tokens are the local estimate over its
//     own JSON, as it was last declared (a removed tool keeps its last one);
//   - a request is one assistant message after the first user message; a tool
//     was declared for the requests made while it was in the list, and costs
//     tokens x (requests it was declared for / the session's own requests);
//   - a tool ran when a tool result names it; a turn's requests all belong to
//     the model of the turn's last assistant message.
// A leaf with no system message has no inventory and is left out (D29).

export interface PiBranchFacts {
  // The branch's place in its file, to rebuild the session id the products give it.
  leafId: string;
  leafIndex: number;
  leafCount: number;
  // The session header's time: the day the saving is priced on.
  startedAt: string | undefined;
  // Tool name -> definition tokens (as last declared) and the requests it was declared for;
  // undefined when the branch has no system message.
  declared: Map<string, { tokens: number; loadedRequests: number }> | undefined;
  invoked: Set<string>;
  // Own requests (the shared prefix left out), by model.
  requestsByModel: Map<string, number>;
  ownRequests: number;
  sharedPrefixRequests: number;
}

const idOf = (line: RawLine): string | undefined => (typeof line.id === "string" ? line.id : undefined);
const roleOf = (line: RawLine): unknown => messageOf(line)?.role;

function piChains(lines: readonly RawLine[]): RawLine[][] {
  const body = lines.filter((line) => line.type !== "session" && idOf(line) !== undefined);
  const byId = new Map(body.map((line) => [idOf(line)!, line]));
  const parents = new Set(body.map((line) => line.parentId).filter((id): id is string => typeof id === "string"));
  return body
    .filter((line) => !parents.has(idOf(line)!))
    .map((leaf) => {
      const chain: RawLine[] = [];
      const seen = new Set<string>();
      for (let line: RawLine | undefined = leaf; line !== undefined && !seen.has(idOf(line)!); line = typeof line.parentId === "string" ? byId.get(line.parentId) : undefined) {
        seen.add(idOf(line)!);
        chain.push(line);
      }
      return chain.reverse();
    });
}

interface PiTool {
  name: string;
  definition: Record<string, unknown>;
}
const piToolsIn = (value: unknown): PiTool[] =>
  Array.isArray(value) ? value.filter(isRecord).flatMap((tool) => (typeof tool.name === "string" ? [{ name: tool.name, definition: tool }] : [])) : [];

export function piBranchesOf(lines: readonly RawLine[]): PiBranchFacts[] {
  const header = lines.find((line) => line.type === "session");
  const startedAt = typeof header?.timestamp === "string" ? header.timestamp : undefined;
  const chains = piChains(lines);
  return chains.map((chain, leafIndex) => {
    const earlier = new Set(chains.slice(0, leafIndex).flatMap((other) => other.map((line) => idOf(line)!)));
    // Requests of the shared prefix: assistant messages in the leading entries an earlier leaf holds.
    let sharedPrefixRequests = 0;
    {
      let turns = false;
      for (const line of chain) {
        if (!earlier.has(idOf(line)!)) break;
        turns ||= roleOf(line) === "user";
        if (turns && roleOf(line) === "assistant") sharedPrefixRequests += 1;
      }
    }

    let current: Map<string, PiTool> | undefined;
    const history = new Map<string, { definition: Record<string, unknown>; loadedRequests: number }>();
    const invoked = new Set<string>();
    const requestsByModel = new Map<string, number>();
    let ownRequests = 0;
    let assistants = 0;
    let turns = false;
    const turnRequests: number[] = [];
    const turnModels: (string | undefined)[] = [];

    for (const line of chain) {
      const role = roleOf(line);
      if (role === "user") {
        turns = true;
        turnRequests.push(0);
        turnModels.push(undefined);
      }
      if (turns && role === "assistant") {
        assistants += 1;
        const model = messageOf(line)?.model;

        turnModels[turnModels.length - 1] = typeof model === "string" ? model : "unknown";
        if (assistants > sharedPrefixRequests) {
          turnRequests[turnRequests.length - 1]! += 1;
          ownRequests += 1;
          for (const name of current?.keys() ?? []) history.get(name)!.loadedRequests += 1;
        }
      }
      if (turns && role === "toolResult") {
        const name = messageOf(line)?.toolName;
        if (typeof name === "string") invoked.add(name);
      }
      const system = line.type === "message" && role === "system" ? messageOf(line) : line.type === "compaction" && isRecord(line.systemMessage) ? line.systemMessage : undefined;
      if (system) {
        // A system message afresh: `replace: true`, or a compaction's checkpoint.
        if (current === undefined || line.type === "compaction" || system.replace === true) current = new Map();
        for (const tool of piToolsIn(system.toolsRemoved)) current.delete(tool.name);
        for (const tool of piToolsIn(system.toolsAdded)) {
          current.set(tool.name, tool);
          history.set(tool.name, { definition: tool.definition, loadedRequests: history.get(tool.name)?.loadedRequests ?? 0 });
        }
      }
    }
    turnRequests.forEach((count, index) => {
      const model = turnModels[index] ?? "unknown";
      if (count > 0) requestsByModel.set(model, (requestsByModel.get(model) ?? 0) + count);
    });
    return {
      leafId: idOf(chain.at(-1)!)!,
      leafIndex,
      leafCount: chains.length,
      startedAt,
      declared:
        current === undefined
          ? undefined
          : new Map([...history].map(([name, { definition, loadedRequests }]) => [name, { tokens: countTokens(JSON.stringify(definition)), loadedRequests }])),
      invoked,
      requestsByModel,
      ownRequests,
      sharedPrefixRequests,
    };
  });
}

// The branch's models all have a price on its start day (the book is anthropic-api's:
// a local model has none, so its money is Not priced).
export function piBranchPriced(branch: PiBranchFacts, tables: ModelTables): boolean {
  const atMs = branch.startedAt === undefined ? Number.NaN : Date.parse(branch.startedAt);
  if (Number.isNaN(atMs)) return false;
  return [...branch.requestsByModel.keys()].every((model) => tables.priceVersion(model, atMs) !== undefined);
}

export interface PiUnusedToolRow extends UnusedToolRow {
  // The window's branches that entered the row (inventory, own requests) and
  // whether the row holds the priced or the unpriced ones.
  branches: PiBranchFacts[];
}

// One row of the unused-tools list for a group: the branches whose money can be priced
// (bucket "priced") or not ("unpriced"). `ran` looks at every branch with an inventory.
export function piUnusedToolRowOf(subject: string, branches: readonly PiBranchFacts[], tables: ModelTables, bucket: "priced" | "unpriced"): PiUnusedToolRow {
  let ran = false;
  const rows: Array<{ branch: PiBranchFacts; tokens: number; weighted: number }> = [];
  const byTool = new Map<string, { total: number; sessions: number }>();
  for (const branch of branches) {
    if (branch.declared === undefined) continue;
    if ([...branch.invoked].some((name) => toolGroupOf(name) === subject)) ran = true;
    if (branch.ownRequests === 0 || piBranchPriced(branch, tables) !== (bucket === "priced")) continue;
    let tokens = 0;
    let weighted = 0;
    let loaded = false;
    for (const [name, { tokens: count, loadedRequests }] of branch.declared) {
      if (toolGroupOf(name) !== subject) continue;
      loaded = true;
      tokens += count;
      weighted += count * Math.min(1, loadedRequests / branch.ownRequests);
      const sum = byTool.get(name) ?? { total: 0, sessions: 0 };
      byTool.set(name, { total: sum.total + count, sessions: sum.sessions + 1 });
    }
    if (loaded) rows.push({ branch, tokens, weighted });
  }
  let low = 0;
  let high = 0;
  let pricedSessions = 0;
  if (bucket === "priced") {
    for (const { branch, weighted } of rows) {
      const atMs = Date.parse(branch.startedAt!);
      for (const [model, requests] of branch.requestsByModel) {
        const tier = tierFor(tables.priceVersion(model, atMs)!, weighted);
        low += (weighted * tier.cachedInputUsdPerM * requests) / 1_000_000;
        high += (weighted * tier.inputUsdPerM * requests) / 1_000_000;
      }
      pricedSessions += 1;
    }
  }
  const requests = rows.reduce((sum, { branch }) => sum + branch.ownRequests, 0);
  const tokensPerSession = rows.length === 0 ? 0 : Math.round(rows.reduce((sum, row) => sum + row.tokens, 0) / rows.length);
  const perTool = [...byTool].map(([rawName, { total, sessions: loadedIn }]) => ({ rawName, name: toolDisplayNameOf(rawName), tokens: Math.round(total / loadedIn), sessions: loadedIn }));
  return { perTool, sessions: rows.length, requests, tokensPerSession, ran, low, high, pricedSessions, branches: rows.map((row) => row.branch) };
}
