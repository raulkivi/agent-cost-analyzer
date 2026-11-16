// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Phase 15's exit check (docs/plans/cost-by-repository-and-project.md §15): an
// independent oracle for cost by repository and project. It reads the raw logs,
// the projects file and the bundled price-book JSON, and shares no code with the
// cost cube, the pricer, the repository resolver or the log readers: a bug in
// one of those can't also be in here. Its only import from the product's side
// is savings-oracle.mts's model spellings (itself an independent oracle).
//
// Definitions, from the plan (not from the code):
//   - repository (§4.2): walk up from the folder to the nearest .git (a .git
//     file is followed to its gitdir, then its commondir), take the origin
//     remote (else the first) and normalise it; no remote: local:<main root>;
//     an existing folder outside a repository: path:<folder>; a folder that is
//     gone: the recorded repository (a remote, or repository:<owner/name>),
//     else path:<folder>; no folder: unattributed. Aliases apply first (§7).
//   - project (§7): the project whose member names the repository (this check
//     writes whole-repository members only).
//   - turn: Claude Code, one real prompt on the active branch (last-prompt's
//     leaf) and the requests (message ids, "<synthetic>" left out) up to the
//     next; pi, one user message and every usage up to the next; Copilot Chat,
//     one session-store turn of an interactive chat session (agent_name
//     'GitHub Copilot Chat', agentic-coding-explained.md §18.2), its usage
//     from the debug log's turn with the same prompt (§4.1) plus the subagent
//     runs started in it; VS Code's Agent Host, one row of the session's
//     session.db (its turn_usage: token totals, model, AI Credits), timed by
//     the Copilot CLI event log's user.message with the row's event id, its
//     cache writes from that turn's usage records when they add up to the
//     totals.
//   - turn time: the prompt's own time, else the session's start; month = UTC.
//   - billed (§5): Copilot's copilotUsageNanoAiu / 1e9 AI Credits, unknown if
//     any request lacks it; reported: pi's Usage.cost.total (USD), unknown if
//     any usage lacks it; priced (§6.2): tokens x the list version in force on
//     the turn's channel at its time, per model; Copilot in AI Credits at
//     1 credit = $0.01. Preferred = billed, else reported, else priced.
//   - channel (§6.3): Copilot github-copilot, Claude Code anthropic-api, pi the
//     API of the provider it names (anthropic, openai, google); else unknown.
//   - cache writes (step 15.6 notes): a recorded 1-hour split is used; else
//     Claude Code's writes are 1-hour, the others' standard; Copilot's unknown
//     writes are inside uncached input, so a version charging writes as input
//     still prices them. A tier is picked by the turn's prompt; a turn of
//     several requests whose sum passes the first tier is unknown (limitation
//     L1: only the sum is kept per turn, so each request's tier is not known).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { bookModelIds, parseJsonl, type RawLine } from "./savings-oracle.mjs";

export type ProviderId = "vscode" | "claude-code" | "pi-agent";
export type Currency = "AI_CREDITS" | "USD";
export type Basis = "billed" | "reported" | "priced" | "preferred";
export const BASES: readonly Basis[] = ["preferred", "billed", "reported", "priced"];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const num = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const str = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

// ---------------------------------------------------------------- repository

export function normaliseRemote(url: string): string | null {
  let rest = url.trim();
  if (rest === "") return null;
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(rest);
  let hostAndPath: string;
  if (scheme) {
    rest = rest.slice(scheme[0].length);
    const at = rest.lastIndexOf("@", rest.indexOf("/") === -1 ? rest.length : rest.indexOf("/"));
    if (at !== -1) rest = rest.slice(at + 1);
    const slash = rest.indexOf("/");
    if (slash === -1) return null;
    const host = rest.slice(0, slash).replace(/:\d+$/, "");
    hostAndPath = `${host}/${rest.slice(slash + 1)}`;
  } else {
    // scp-like: user@host:path
    const match = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(rest);
    if (!match) return null;
    hostAndPath = `${match[1]}/${match[2]}`;
  }
  const cleaned = hostAndPath.replace(/\/+$/, "").replace(/\.git$/i, "").replace(/\/+$/, "").toLowerCase();
  const [host, ...parts] = cleaned.split("/");
  return host && parts.length > 0 && parts.every((p) => p !== "") ? cleaned : null;
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function readText(p: string): string | null {
  try {
    return readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

// The remotes of a git config, in file order: [name, url].
function remotesOf(config: string): [string, string][] {
  const remotes: [string, string][] = [];
  let current: string | null = null;
  for (const raw of config.split("\n")) {
    const line = raw.trim();
    const section = /^\[\s*remote\s+"([^"]+)"\s*\]$/.exec(line);
    if (section) {
      current = section[1]!;
      continue;
    }
    if (line.startsWith("[")) {
      current = null;
      continue;
    }
    const url = /^url\s*=\s*(.+)$/.exec(line);
    if (current !== null && url && !remotes.some(([name]) => name === current)) remotes.push([current, url[1]!.trim()]);
  }
  return remotes;
}

// The main repository's git dir for the .git entry at `dotGit`.
function mainGitDir(dotGit: string): string | null {
  if (isDir(dotGit)) return dotGit;
  const text = readText(dotGit);
  const match = text ? /^gitdir:\s*(.+)$/m.exec(text) : null;
  if (!match) return null;
  const gitDir = path.resolve(path.dirname(dotGit), match[1]!.trim());
  const common = readText(path.join(gitDir, "commondir"));
  return common === null ? gitDir : path.resolve(gitDir, common.trim());
}

function keyOfRecorded(recorded: string): string | null {
  const remote = /[:@]/.test(recorded) || /^[^/\s]+\.[^/\s]+\//.test(recorded) ? normaliseRemote(recorded) : null;
  if (remote) return remote;
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(recorded) ? `repository:${recorded}` : null;
}

const keyCache = new Map<string, string | null>();

export function repositoryKeyOf(folder: string | null, recordedRepository: string | null): string | null {
  if (folder === null) return null;
  const cacheKey = `${folder}\u0000${recordedRepository ?? ""}`;
  if (keyCache.has(cacheKey)) return keyCache.get(cacheKey)!;
  let key: string | null;
  if (!existsSync(folder)) {
    key = (recordedRepository !== null ? keyOfRecorded(recordedRepository) : null) ?? `path:${folder}`;
  } else {
    key = `path:${folder}`;
    for (let dir = path.resolve(folder); ; dir = path.dirname(dir)) {
      const dotGit = path.join(dir, ".git");
      if (existsSync(dotGit)) {
        const gitDir = mainGitDir(dotGit);
        if (gitDir !== null) {
          const remotes = remotesOf(readText(path.join(gitDir, "config")) ?? "");
          const chosen = remotes.find(([name]) => name === "origin") ?? remotes[0];
          const remote = chosen ? normaliseRemote(chosen[1]) : null;
          key = remote ?? `local:${path.basename(gitDir) === ".git" ? path.dirname(gitDir) : gitDir}`;
        }
        break;
      }
      if (path.dirname(dir) === dir) break;
    }
  }
  keyCache.set(cacheKey, key);
  return key;
}

// Every answer names a local repository or folder by its last segment only.
export function redactKey(key: string): string {
  for (const prefix of ["local:", "path:"]) if (key.startsWith(prefix)) return `${prefix}${path.basename(key.slice(prefix.length))}`;
  return key;
}

// ------------------------------------------------------------------ projects

export interface OracleProject {
  id: string;
  members: { repository: string }[];
}

export function projectOf(key: string | null, projects: readonly OracleProject[], aliases: Readonly<Record<string, string>>): string | null {
  if (key === null) return null;
  const resolved = aliases[key] ?? key;
  return projects.find((project) => project.members.some((member) => member.repository === resolved))?.id ?? null;
}

// ---------------------------------------------------------------- price book

export interface BookTier {
  maxInputTokens?: number;
  inputUsdPerM: number;
  cachedInputUsdPerM: number;
  cacheWriteUsdPerM: number | null;
  extendedCacheWriteUsdPerM?: number;
  outputUsdPerM: number;
}

export interface BookVersion {
  id: string;
  channel: string;
  modelId: string;
  effectiveFrom: string;
  effectiveTo?: string;
  kind: string;
  tiers: BookTier[];
}

export function loadBook(priceBookDir: string): BookVersion[] {
  return readdirSync(priceBookDir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .flatMap((file) => (JSON.parse(readFileSync(path.join(priceBookDir, file), "utf-8")) as { versions: BookVersion[] }).versions);
}

const dayStart = (date: string): number => Date.parse(`${date}T00:00:00Z`);

export type VersionLookup = { known: true; version: BookVersion } | { known: false; reason: string };

// List and promo versions only: a contract applies in its own scope, and the
// check's projects file prices nothing until its statement step.
export function versionAt(book: readonly BookVersion[], channel: string, logModel: string | null, at: string): VersionLookup {
  if (logModel === null || logModel === "unknown") return { known: false, reason: "no model" };
  const time = Date.parse(at);
  for (const candidate of bookModelIds(logModel)) {
    const ofModel = book.filter((v) => v.channel === channel && v.kind !== "contract" && v.modelId.toLowerCase() === candidate);
    if (ofModel.length === 0) continue;
    const inForce = ofModel.filter((v) => dayStart(v.effectiveFrom) <= time && (v.effectiveTo === undefined || time < dayStart(v.effectiveTo)));
    if (inForce.length > 1) throw new Error(`price book: overlapping versions of ${candidate} on ${channel}`);
    return inForce.length === 1 ? { known: true, version: inForce[0]! } : { known: false, reason: "no version in force" };
  }
  return { known: false, reason: "model not in the book" };
}

// --------------------------------------------------------------------- turns

export interface Tokens {
  uncached: number;
  cacheRead: number;
  cacheWrite: number | null; // null: unknown
  cacheWrite1h: number | null; // the 1-hour subset; null: not split
  output: number;
}

// One model's share of a turn: the main agent's, or one subagent run's.
export interface Part {
  model: string | null;
  requests: number;
  tokens: Tokens | null; // null: unknown
}

export interface OracleTurn {
  provider: ProviderId;
  session: string; // never printed
  turnKey: string;
  at: string | null;
  folder: string | null;
  recordedRepository: string | null;
  channel: string | null;
  parts: Part[];
  billed: number | null | undefined; // AI Credits; null unknown; undefined: not recorded by this provider
  reported: number | null | undefined; // USD
}

export type Figure = { known: true; amount: number; currency: Currency } | { known: false };

const USD_PER_AI_CREDIT = 0.01;
const DEFAULT_1H_WRITES: Readonly<Record<ProviderId, boolean>> = { "claude-code": true, vscode: false, "pi-agent": false };
const WRITES_INSIDE_UNCACHED: Readonly<Record<ProviderId, boolean>> = { "claude-code": false, vscode: true, "pi-agent": false };

// One part's priced amount in the channel's currency, and the version used.
export function pricePart(turn: OracleTurn, part: Part, book: readonly BookVersion[]): { amount: number; version: BookVersion } | null {
  if (turn.channel === null || turn.at === null || part.tokens === null || part.model === null) return null;
  const lookup = versionAt(book, turn.channel, part.model, turn.at);
  if (!lookup.known) return null;
  const { version } = lookup;
  const t = part.tokens;
  const writesAsInput = version.tiers.every((tier) => tier.cacheWriteUsdPerM === null);
  if (t.cacheWrite === null && !(WRITES_INSIDE_UNCACHED[turn.provider] && writesAsInput)) return null;
  const writes = t.cacheWrite ?? 0;
  const prompt = t.uncached + t.cacheRead + writes;
  const tier = version.tiers.find((x) => x.maxInputTokens === undefined || prompt <= x.maxInputTokens) ?? version.tiers.at(-1)!;
  if (version.tiers.length > 1 && part.requests !== 1 && tier !== version.tiers[0]) return null; // L1
  const extended = t.cacheWrite1h !== null ? Math.min(t.cacheWrite1h, writes) : DEFAULT_1H_WRITES[turn.provider] ? writes : 0;
  const writeRate = tier.cacheWriteUsdPerM ?? tier.inputUsdPerM;
  if (extended > 0 && tier.extendedCacheWriteUsdPerM === undefined && tier.cacheWriteUsdPerM !== null) return null;
  const extendedRate = tier.extendedCacheWriteUsdPerM ?? writeRate;
  const usd = (t.uncached * tier.inputUsdPerM + t.cacheRead * tier.cachedInputUsdPerM + (writes - extended) * writeRate + extended * extendedRate + t.output * tier.outputUsdPerM) / 1e6;
  return { amount: version.channel === "github-copilot" ? usd / USD_PER_AI_CREDIT : usd, version };
}

export function pricedFigure(turn: OracleTurn, book: readonly BookVersion[]): Figure {
  if (turn.parts.length === 0 || turn.channel === null) return { known: false };
  let amount = 0;
  for (const part of turn.parts) {
    const priced = pricePart(turn, part, book);
    if (priced === null) return { known: false };
    amount += priced.amount;
  }
  return { known: true, amount, currency: turn.channel === "github-copilot" ? "AI_CREDITS" : "USD" };
}

export function figuresOf(turn: OracleTurn, book: readonly BookVersion[]): Record<Basis, Figure> {
  const billed: Figure = typeof turn.billed === "number" ? { known: true, amount: turn.billed, currency: "AI_CREDITS" } : { known: false };
  const reported: Figure = typeof turn.reported === "number" ? { known: true, amount: turn.reported, currency: "USD" } : { known: false };
  const priced = pricedFigure(turn, book);
  return { billed, reported, priced, preferred: billed.known ? billed : reported.known ? reported : priced };
}

// --------------------------------------------------------------------- cells

export interface BasisSum {
  knownTurns: number;
  amounts: Partial<Record<Currency, number>>;
}

export interface Cell {
  turns: number;
  sessions: Set<string>;
  basis: Record<Basis, BasisSum>;
}

export function emptyCell(): Cell {
  const basis = {} as Record<Basis, BasisSum>;
  for (const b of BASES) basis[b] = { knownTurns: 0, amounts: {} };
  return { turns: 0, sessions: new Set(), basis };
}

export function addTurn(cell: Cell, turn: OracleTurn, book: readonly BookVersion[]): void {
  cell.turns += 1;
  cell.sessions.add(`${turn.provider}:${turn.session}`);
  const figures = figuresOf(turn, book);
  for (const b of BASES) {
    const figure = figures[b];
    if (!figure.known) continue;
    const sum = cell.basis[b];
    sum.knownTurns += 1;
    sum.amounts[figure.currency] = (sum.amounts[figure.currency] ?? 0) + figure.amount;
  }
}

export const monthOf = (at: string): string => new Date(Date.parse(at)).toISOString().slice(0, 7);

// ------------------------------------------------------- Claude Code reader

const messageOf = (line: RawLine): Record<string, unknown> | undefined => (isRecord(line.message) ? line.message : undefined);

function parentOf(line: RawLine): string | undefined {
  return str(line.parentUuid) ?? str(line.logicalParentUuid) ?? undefined;
}

function activeBranch(lines: readonly RawLine[]): RawLine[] {
  let leaf: string | undefined;
  for (let i = lines.length - 1; i >= 0 && leaf === undefined; i--) if (lines[i]!.type === "last-prompt") leaf = str(lines[i]!.leafUuid) ?? undefined;
  if (leaf === undefined) {
    const parents = new Set(lines.map(parentOf).filter((id): id is string => id !== undefined));
    leaf = lines.map((l) => str(l.uuid)).filter((id): id is string => id !== null && !parents.has(id)).at(-1);
  }
  const byId = new Map(lines.filter((l) => str(l.uuid) !== null).map((l) => [l.uuid as string, l]));
  const chain: RawLine[] = [];
  const seen = new Set<string>();
  for (let id = leaf; id !== undefined && !seen.has(id); ) {
    const line = byId.get(id);
    if (!line) break;
    seen.add(id);
    chain.push(line);
    id = parentOf(line);
  }
  return chain.reverse();
}

function isRealPrompt(line: RawLine): boolean {
  if (line.type !== "user" || line.isMeta === true || line.isCompactSummary === true) return false;
  const content = messageOf(line)?.content;
  if (typeof content === "string") return true;
  return Array.isArray(content) && content.some((block) => !(isRecord(block) && block.type === "tool_result"));
}

function promptText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (isRecord(block) && typeof block.text === "string" ? block.text : ""))
    .filter((text) => text !== "")
    .join("\n");
}

export interface ReadTurns {
  // The session's start, which selects it (the earliest time it records).
  start: string | null;
  turns: OracleTurn[];
  // Prompt texts, kept in memory only to prove no answer echoes one.
  prompts: string[];
}

export function claudeCodeTurns(text: string, file: string): ReadTurns {
  const branch = activeBranch(parseJsonl(text));
  const sessionFolder = branch.map((l) => str(l.cwd)).find((cwd) => cwd !== null) ?? null;
  const sessionStart = branch.map((l) => str(l.timestamp)).filter((t): t is string => t !== null).sort()[0] ?? null;
  const turns: OracleTurn[] = [];
  const prompts: string[] = [];
  let current: { prompt: RawLine; lines: RawLine[] } | undefined;
  const flush = () => {
    if (!current) return;
    const rounds = new Map<string, Record<string, unknown>>();
    let model: string | null = null;
    for (const line of current.lines) {
      const message = messageOf(line);
      const id = line.type === "assistant" ? str(message?.id) : null;
      if (id === null || message?.model === "<synthetic>") continue;
      if (!rounds.has(id)) rounds.set(id, message!);
      model = str(message?.model) ?? model;
    }
    // A round's model: the first entry carrying one; the turn's: its last round's.
    const list = [...rounds.values()];
    model = list.length > 0 ? str(list.at(-1)!.model) : null;
    let tokens: Tokens | null = { uncached: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, output: 0 };
    for (const message of list) {
      const usage = isRecord(message.usage) ? message.usage : {};
      const [input, read, write, output] = [num(usage.input_tokens), num(usage.cache_read_input_tokens), num(usage.cache_creation_input_tokens), num(usage.output_tokens)];
      if (input === undefined || read === undefined || write === undefined || output === undefined || tokens === null) {
        tokens = null;
        continue;
      }
      const split = isRecord(usage.cache_creation) ? num(usage.cache_creation.ephemeral_1h_input_tokens) : undefined;
      tokens.uncached += input;
      tokens.cacheRead += read;
      tokens.cacheWrite! += write;
      tokens.output += output;
      tokens.cacheWrite1h = tokens.cacheWrite1h === null ? null : split !== undefined ? tokens.cacheWrite1h + split : write === 0 ? tokens.cacheWrite1h : null;
    }
    const at = str(current.prompt.timestamp) ?? sessionStart;
    turns.push({
      provider: "claude-code",
      session: file,
      turnKey: `${file}#${turns.length}`,
      at,
      folder: str(current.prompt.cwd) ?? sessionFolder,
      recordedRepository: null,
      channel: "anthropic-api",
      parts: [{ model, requests: list.length, tokens }],
      billed: undefined,
      reported: undefined,
    });
    prompts.push(promptText(messageOf(current.prompt)?.content));
  };
  for (const line of branch) {
    if (isRealPrompt(line)) {
      flush();
      current = { prompt: line, lines: [line] };
    } else current?.lines.push(line);
  }
  flush();
  return { start: sessionStart, turns, prompts };
}

// ---------------------------------------------------------------- pi reader

const PI_CHANNELS: Readonly<Record<string, string>> = { anthropic: "anthropic-api", openai: "openai-api", google: "google-api" };

export function piTurns(text: string, file: string): ReadTurns {
  const lines = parseJsonl(text);
  const header = lines.find((l) => l.type === "session");
  // One branch per file here (the check reports a file with forks, see the test).
  const turns: OracleTurn[] = [];
  const prompts: string[] = [];
  const isUser = (l: RawLine) => l.type === "message" && messageOf(l)?.role === "user";
  const usageOf = (l: RawLine): Record<string, unknown> | null | undefined => {
    const message = messageOf(l);
    if (l.type === "message" && message?.role === "assistant") return isRecord(message.usage) ? message.usage : null;
    if (l.type === "message" && message?.role === "toolResult") return isRecord(message.usage) ? message.usage : undefined;
    if (l.type === "usage" || l.type === "compaction" || l.type === "branch_summary") return isRecord(l.usage) ? l.usage : undefined;
    return undefined;
  };
  let leading: RawLine[] = [];
  let current: { prompt: RawLine; lines: RawLine[] } | undefined;
  const flush = () => {
    if (!current) return;
    const assistants = current.lines.map(messageOf).filter((m) => m?.role === "assistant");
    const last = assistants.at(-1);
    const usages = current.lines.map(usageOf).filter((u) => u !== undefined);
    let tokens: Tokens | null = { uncached: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, output: 0 };
    let reported: number | null = 0;
    for (const usage of usages) {
      const values = usage ? [num(usage.input), num(usage.cacheRead), num(usage.cacheWrite), num(usage.output)] : [];
      if (values.length === 0 || values.some((v) => v === undefined) || tokens === null) tokens = null;
      else {
        tokens.uncached += values[0]!;
        tokens.cacheRead += values[1]!;
        tokens.cacheWrite! += values[2]!;
        tokens.output += values[3]!;
        const oneHour = num(usage!.cacheWrite1h);
        tokens.cacheWrite1h = tokens.cacheWrite1h === null ? null : oneHour !== undefined ? tokens.cacheWrite1h + oneHour : values[2] === 0 ? tokens.cacheWrite1h : null;
      }
      const cost = usage && isRecord(usage.cost) ? num(usage.cost.total) : undefined;
      reported = reported === null || cost === undefined || cost < 0 ? null : reported + cost;
    }
    const provider = str(last?.provider);
    turns.push({
      provider: "pi-agent",
      session: file,
      turnKey: `${file}#${turns.length}`,
      at: str(current.prompt.timestamp) ?? str(header?.timestamp),
      folder: str(header?.cwd),
      recordedRepository: null,
      channel: provider !== null ? PI_CHANNELS[provider] ?? null : null,
      parts: [{ model: last ? str(last.model) ?? "unknown" : null, requests: assistants.length, tokens }],
      billed: undefined,
      reported,
    });
    prompts.push(promptText(messageOf(current.prompt)?.content));
  };
  for (const line of lines) {
    if (line.type === "session") continue;
    if (isUser(line)) {
      flush();
      current = { prompt: line, lines: turns.length === 0 && current === undefined ? [...leading, line] : [line] };
      leading = [];
    } else if (current) current.lines.push(line);
    else leading.push(line);
  }
  flush();
  return { start: str(header?.timestamp), turns, prompts };
}

// Whether a pi file holds more than one branch (the product lists each as a session).
export function piLeafCount(text: string): number {
  const lines = parseJsonl(text).filter((l) => l.type !== "session");
  const parents = new Set(lines.map((l) => str(l.parentId)).filter((id): id is string => id !== null));
  return lines.filter((l) => str(l.id) !== null && !parents.has(l.id as string)).length;
}

// ----------------------------------------------------- Copilot Chat reader

// For each log turn, its store turn index: the one offset where every
// overlapping prompt agrees; else, with as many log turns as store turns, the
// position; else none. Log turns past the store's last continue its numbering.
export function alignLogTurns(logPrompts: readonly (string | null)[], storePrompts: readonly (string | null)[]): (number | null)[] {
  if (logPrompts.length === 0) return [];
  const agrees = (offset: number) => {
    const overlap = Math.min(logPrompts.length, storePrompts.length - offset);
    if (overlap <= 0) return false;
    for (let i = 0; i < overlap; i++) if (logPrompts[i] === null || logPrompts[i] !== storePrompts[offset + i]) return false;
    return true;
  };
  const offsets = storePrompts.map((_, offset) => offset).filter(agrees);
  let start: number;
  if (storePrompts.length === 0) start = 0;
  else if (offsets.length === 1) start = offsets[0]!;
  else if (logPrompts.length === storePrompts.length) start = 0;
  else return logPrompts.map(() => null);
  return logPrompts.map((_, i) => start + i);
}

export interface StoreSession {
  id: string;
  cwd: string | null;
  repository: string | null;
  created_at: string | null;
}

export interface StoreTurn {
  turn_index: number;
  user_message: string | null;
  timestamp: string | null;
}

interface LogRequests {
  model: string | null;
  requests: number;
  tokens: Tokens;
  nano: number | null; // null: some request lacks credits
}

function sumRequests(events: readonly RawLine[]): LogRequests {
  const out: LogRequests = { model: null, requests: 0, tokens: { uncached: 0, cacheRead: 0, cacheWrite: null, cacheWrite1h: null, output: 0 }, nano: 0 };
  for (const event of events) {
    if (event.type !== "llm_request") continue;
    const attrs = isRecord(event.attrs) ? event.attrs : {};
    const input = num(attrs.inputTokens);
    const output = num(attrs.outputTokens);
    if (input === undefined || output === undefined) continue;
    const cached = num(attrs.cachedTokens) ?? 0;
    out.requests += 1;
    out.tokens.uncached += Math.max(input - cached, 0);
    out.tokens.cacheRead += cached;
    out.tokens.output += output;
    const nano = num(attrs.copilotUsageNanoAiu);
    out.nano = out.nano === null || nano === undefined || nano < 0 ? null : out.nano + nano;
    out.model = str(attrs.model) ?? out.model;
  }
  return out;
}

export function copilotClassicTurns(input: {
  session: StoreSession;
  storeTurns: readonly StoreTurn[];
  mainText: string | null;
  subagentFiles: readonly { name: string; text: string }[];
}): ReadTurns {
  const events = input.mainText === null ? [] : parseJsonl(input.mainText);
  // Log turns: from one user_message to the next.
  const logTurns: { prompt: string | null; ts: number | null; events: RawLine[]; runs: string[] }[] = [];
  for (const event of events) {
    if (event.type === "user_message") {
      const attrs = isRecord(event.attrs) ? event.attrs : {};
      logTurns.push({ prompt: str(attrs.content), ts: num(event.ts) ?? null, events: [], runs: [] });
      continue;
    }
    const turn = logTurns.at(-1);
    if (!turn) continue;
    turn.events.push(event);
    if (event.type === "child_session_ref" && isRecord(event.attrs)) {
      const file = str(event.attrs.childLogFile);
      if (file) turn.runs.push(file);
    }
  }
  // A run no ref names belongs to the log turn whose window holds its first event.
  const referenced = new Set(logTurns.flatMap((t) => t.runs));
  for (const file of input.subagentFiles) {
    if (referenced.has(file.name)) continue;
    const first = parseJsonl(file.text).map((e) => num(e.ts)).find((ts) => ts !== undefined);
    if (first === undefined) continue;
    const index = logTurns.findIndex((t, i) => t.ts !== null && t.ts <= first && (i + 1 === logTurns.length || (logTurns[i + 1]!.ts !== null && first < logTurns[i + 1]!.ts!)));
    if (index !== -1) logTurns[index]!.runs.push(file.name);
  }
  const files = new Map(input.subagentFiles.map((f) => [f.name, f.text]));
  const storeTurns = [...input.storeTurns].sort((a, b) => a.turn_index - b.turn_index);
  const placement = alignLogTurns(
    logTurns.map((t) => t.prompt),
    storeTurns.map((t) => t.user_message),
  );
  const byStoreIndex = new Map<number, (typeof logTurns)[number]>();
  placement.forEach((position, i) => {
    if (position !== null && position < storeTurns.length) byStoreIndex.set(storeTurns[position]!.turn_index, logTurns[i]!);
  });
  const turns = storeTurns.map((storeTurn): OracleTurn => {
    const log = byStoreIndex.get(storeTurn.turn_index);
    const main = log ? sumRequests(log.events) : undefined;
    const runs = (log?.runs ?? []).map((name) => (files.has(name) ? sumRequests(parseJsonl(files.get(name)!)) : null));
    const parts: Part[] = [];
    let billed: number | null = null;
    if (main && main.requests > 0) {
      parts.push({ model: main.model, requests: main.requests, tokens: main.tokens });
      let nano: number | null = main.nano;
      for (const run of runs) {
        if (run === null) {
          nano = null;
          continue;
        }
        if (run.requests === 0) continue;
        parts.push({ model: run.model, requests: run.requests, tokens: run.tokens });
        nano = nano === null || run.nano === null ? null : nano + run.nano;
      }
      billed = nano === null ? null : nano / 1e9;
    }
    return {
      provider: "vscode",
      session: input.session.id,
      turnKey: `${input.session.id}#${storeTurn.turn_index}`,
      at: storeTurn.timestamp ?? input.session.created_at,
      folder: input.session.cwd,
      recordedRepository: input.session.repository,
      channel: "github-copilot",
      parts,
      billed,
      reported: undefined,
    };
  });
  return { start: input.session.created_at, turns, prompts: storeTurns.map((t) => t.user_message ?? "") };
}

// ------------------------------------------------- VS Code Agent Host reader

// A Copilot CLI session's catalog row (sessions_v2, provider 'copilotcli') is
// keyed by its storage URI, copilotcli:/<id>, or, in a run of VS Code
// Insiders builds, by the Agent Host Protocol runtime URI, ahp-session:/<id>
// (VS Code's sessionStorageIdentity metadata pairs the two). The id is the
// path after either scheme, when that is one safe path segment.
const AGENT_HOST_SCHEMES = ["copilotcli", "ahp-session"] as const;

export function agentHostCatalogIdOf(sessionUri: string): string | null {
  const match = /^(?:copilotcli|ahp-session):\/([0-9A-Za-z][0-9A-Za-z-]*)$/.exec(sessionUri);
  return match ? match[1]! : null;
}

// The catalog's sessions, one per id: both URIs name one session, so an id
// cataloged under both is read from its copilotcli:/ row, and a tombstone
// (a `sessionTombstone:<uri>` key whose value is 'true') under either URI
// deletes it. Rows keep their given order.
export function agentHostCatalogSessions<R extends { session_uri: string }>(rows: readonly R[], tombstoneKeys: ReadonlySet<string>): { id: string; row: R }[] {
  const chosen = new Map<string, R>();
  for (const row of rows) {
    const id = agentHostCatalogIdOf(row.session_uri);
    if (id === null) continue;
    const held = chosen.get(id);
    if (held === undefined || (row.session_uri.startsWith("copilotcli:") && !held.session_uri.startsWith("copilotcli:"))) chosen.set(id, row);
  }
  const deleted = (id: string) => AGENT_HOST_SCHEMES.some((scheme) => tombstoneKeys.has(`sessionTombstone:${scheme}:/${id}`));
  return [...chosen].filter(([id]) => !deleted(id)).map(([id, row]) => ({ id, row }));
}

export interface AgentHostSession {
  id: string;
  startedAt: string; // the catalog's start_time, ISO
  folder: string | null;
}

// One session.db `turns` row (rowid order) with its turn_usage JSON, if any.
export interface AgentHostStoreTurn {
  id: string;
  event_id: string | null;
  usage: string | null;
}

interface HostUsage {
  totals: { input: number; cached: number; output: number } | null;
  model: string | null;
  nano: number | null;
}

function hostUsage(text: string | null): HostUsage | null {
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const meta = isRecord(parsed._meta) ? parsed._meta : {};
  const entries = Array.isArray(meta.turnTokenTotals) ? meta.turnTokenTotals.filter(isRecord) : [];
  const totals =
    Array.isArray(meta.turnTokenTotals) && meta.turnTokenTotals.length > 0
      ? entries.reduce<NonNullable<HostUsage["totals"]>>((t, e) => ({ input: t.input + (num(e.inputTokens) ?? 0), cached: t.cached + (num(e.cachedTokens) ?? 0), output: t.output + (num(e.outputTokens) ?? 0) }), { input: 0, cached: 0, output: 0 })
      : null;
  const nano = isRecord(meta.copilotUsage) ? num(meta.copilotUsage.totalNanoAiu) : undefined;
  return { totals, model: str(parsed.model) ?? (entries[0] ? str(entries[0].model) : null), nano: nano !== undefined && nano >= 0 ? nano : null };
}

const count = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);

// The turn's cache writes: known only when its usage records sum to the
// turn's totals (so they cover every call) and every record reports writes.
function hostWrites(events: readonly RawLine[], totals: NonNullable<HostUsage["totals"]>): number | null {
  const records = events
    .filter((e) => e.type === "session.usage_record" && isRecord(e.data) && isRecord(e.data.usage))
    .map((e) => (e.data as Record<string, Record<string, unknown>>).usage!)
    .map((u) => ({ input: count(u.inputTokens), read: count(u.cacheReadTokens), output: count(u.outputTokens), write: u.cacheDetailsReported === false ? null : count(u.cacheWriteTokens) }))
    .filter((r) => r.input !== null && r.read !== null && r.output !== null);
  if (records.length === 0) return null;
  const sum = (pick: (r: (typeof records)[number]) => number | null) => records.reduce((s, r) => s + pick(r)!, 0);
  if (sum((r) => r.input) !== totals.input || sum((r) => r.read) !== totals.cached || sum((r) => r.output) !== totals.output) return null;
  if (records.some((r) => r.write === null)) return null;
  const writes = sum((r) => r.write);
  return writes <= totals.input - totals.cached ? writes : null;
}

export function agentHostTurns(input: { session: AgentHostSession; storeTurns: readonly AgentHostStoreTurn[]; events: readonly RawLine[] | null }): ReadTurns {
  const events = input.events ?? [];
  // A turn opens at a user.message the user typed: not a subagent's (agentId)
  // nor one an agent sent (source "agent-...").
  const opensTurn = (e: RawLine) => e.type === "user.message" && (e.agentId === undefined || e.agentId === null) && !(isRecord(e.data) && typeof e.data.source === "string" && e.data.source.startsWith("agent-"));
  const indexById = new Map<string, number>();
  events.forEach((e, i) => {
    const id = str(e.id);
    if (id !== null && opensTurn(e) && !indexById.has(id)) indexById.set(id, i);
  });
  // The row's event id (an aborted turn's second row carries it as its id); the first row wins.
  const taken = new Set<number>();
  const placed = input.storeTurns.map((row) => {
    const eventId = row.event_id || (row.id.startsWith("request_") ? null : row.id || null);
    const index = eventId === null ? undefined : indexById.get(eventId);
    if (index === undefined || taken.has(index)) return undefined;
    taken.add(index);
    return index;
  });
  const bounds = [...taken].sort((a, b) => a - b);
  const turns = input.storeTurns.map((row, i): OracleTurn => {
    const index = placed[i];
    const span = index === undefined ? null : events.slice(index + 1, bounds[bounds.indexOf(index) + 1] ?? events.length);
    const usage = hostUsage(row.usage);
    const writes = usage?.totals && span ? hostWrites(span, usage.totals) : null;
    const tokens: Tokens | null = usage?.totals
      ? { uncached: Math.max(usage.totals.input - usage.totals.cached - (writes ?? 0), 0), cacheRead: usage.totals.cached, cacheWrite: writes, cacheWrite1h: null, output: usage.totals.output }
      : null;
    return {
      provider: "vscode",
      session: input.session.id,
      turnKey: `${input.session.id}#${i}`,
      at: (index !== undefined ? str(events[index]!.timestamp) : null) ?? input.session.startedAt,
      folder: input.session.folder,
      recordedRepository: null,
      channel: "github-copilot",
      // The count of requests isn't recorded per turn: 0 stands for "not one".
      parts: [{ model: usage?.model ?? null, requests: 0, tokens }],
      billed: usage?.nano != null ? usage.nano / 1e9 : null,
      reported: undefined,
    };
  });
  const prompts = [...taken].map((i) => events[i]!).map((e) => (isRecord(e.data) && typeof e.data.content === "string" ? e.data.content : ""));
  return { start: input.session.startedAt, turns, prompts };
}
