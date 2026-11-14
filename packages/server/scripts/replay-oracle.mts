// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Phase 14 (docs/plans/analyze-session-replay.md §13): an independent oracle
// for the replay's exit check. It reads the raw logs (Claude Code JSONL, Copilot
// Chat's main.jsonl, the Copilot CLI's events.jsonl) and the bundled price book,
// and shares no code with the request-trace builders, the replay service, the
// simulator or the pricer: a bug in one of those can't also be in here. Claude
// Code's branch and turn rules are the savings oracle's (savings-oracle.mts),
// itself independent of the product.
//
// Definitions, from the plan (§4, §5, §6) and Phase 13's D12, not from the code:
//   - a request is one LLM call of the session's main agent; a turn opens at a
//     human message (Claude Code: a user line that is not a tool result, CLI
//     meta text or a compaction summary; Copilot: a user_message span or a
//     user.message event of the main agent; Copilot local's main agent is
//     debugName panel/editAgent, its helper agents' requests are left out and
//     counted, owner decision 2026-11-14); a turn with any request lacking
//     its token counts, model or time is left out whole ("incomplete"), and a
//     turn with no request is "no-request";
//   - prompt = the whole input (uncached + cache read + cache write);
//   - D12: a request's recorded outcome is a miss when it read nothing, a hit
//     when it read the previous request's prompt (1% slack), else partial; a
//     turn is a miss if any request missed, else partial if any was, else hit;
//   - A3: the session's first request is never compared (cold start);
//   - Claude Code's measured cost (priced, API channel): uncached × input +
//     read × cache read + 5-minute writes × write + 1-hour writes × 1-hour
//     write + output × output, per million, from the price version in force at
//     the turn's start; writes the log doesn't split count as 1-hour (Claude
//     Code's lifetime). Unknown, never 0, when no single-tier version applies.
import { bookModelIds, activeBranchOf, roundsOf, turnsOf, type ModelTables, type RawLine } from "./savings-oracle.mjs";

export interface OracleRequest {
  turn: number;
  atMs: number;
  model: string;
  prompt: number;
  cacheRead: number;
  output: number;
  // Claude Code: the parts its API price needs. Agent Host: writes, null when unreported.
  uncached?: number;
  cacheWrite?: number | null;
  oneHourWrite?: number;
  // VS Code local: the billed AI Credits in nano units, null when not recorded,
  // and the agent that sent it (debugName; the main agent is panel/editAgent).
  nanoAiu?: number | null;
  agent?: string;
}

export const LOCAL_MAIN_AGENT = "panel/editAgent";

export type UntracedKind = "no-request" | "incomplete" | "helpers-only";

// A helper agent's request (Copilot local), outside the main chain.
export interface LeftOutRequest {
  turn: number;
  cacheRead: number | null;
  nanoAiu: number | null;
  agent?: string;
}

export interface OracleSession {
  turns: number;
  // Claude Code: each turn's opening line time (the turn's price date).
  turnStartMs: (number | undefined)[];
  requests: OracleRequest[];
  untraced: Map<number, UntracedKind>;
  // Subagent runs the main chain leaves out (D6).
  subagentRuns: number;
  // The human prompts, for the privacy check only: never printed.
  prompts: string[];
  // Copilot local: the helper agents' requests of every turn.
  leftOut: LeftOutRequest[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const asCount = (value: unknown): number | undefined => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined);
const asFinite = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined);
const timeOf = (value: unknown): number | undefined => (typeof value === "string" && !Number.isNaN(Date.parse(value)) ? Date.parse(value) : undefined);

// Turns are traced whole or not at all; times never go back.
function assemble(perTurn: Array<Array<OracleRequest | undefined>>, base: Omit<OracleSession, "turns" | "requests" | "untraced" | "leftOut">, leftOut: LeftOutRequest[] = []): OracleSession {
  const requests: OracleRequest[] = [];
  const untraced = new Map<number, UntracedKind>();
  perTurn.forEach((figures, turn) => {
    if (figures.length === 0) untraced.set(turn, leftOut.some((r) => r.turn === turn) ? "helpers-only" : "no-request");
    else if (figures.some((f) => f === undefined)) untraced.set(turn, "incomplete");
    else
      for (const f of figures as OracleRequest[]) {
        const previous = requests.at(-1);
        requests.push({ ...f, turn, atMs: Math.max(f.atMs, previous?.atMs ?? Number.NEGATIVE_INFINITY) });
      }
  });
  return { ...base, turns: perTurn.length, requests, untraced, leftOut };
}

// ---------------------------------------------------------------- Claude Code

function claudeFigures(lines: readonly RawLine[]): OracleRequest | undefined {
  const message = (line: RawLine) => (isRecord(line.message) ? line.message : undefined);
  const usage = lines.map((l) => message(l)?.usage).find(isRecord);
  const model = lines.map((l) => message(l)?.model).find((m): m is string => typeof m === "string" && m.length > 0);
  const atMs = lines.map((l) => timeOf(l.timestamp)).find((t) => t !== undefined);
  if (!usage || !model || atMs === undefined) return undefined;
  const uncached = asCount(usage.input_tokens);
  const cacheRead = asCount(usage.cache_read_input_tokens);
  const cacheWrite = asCount(usage.cache_creation_input_tokens);
  const output = asCount(usage.output_tokens);
  if (uncached === undefined || cacheRead === undefined || cacheWrite === undefined || output === undefined) return undefined;
  const oneHour = isRecord(usage.cache_creation) ? asCount(usage.cache_creation.ephemeral_1h_input_tokens) : undefined;
  return {
    turn: 0,
    atMs,
    model,
    prompt: uncached + cacheRead + cacheWrite,
    cacheRead,
    output,
    uncached,
    cacheWrite,
    ...(oneHour !== undefined ? { oneHourWrite: Math.min(oneHour, cacheWrite) } : {}),
  };
}

const promptText = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((block) => (isRecord(block) && typeof block.text === "string" ? block.text : "")).join(" ")
      : "";

export function claudeCodeSessionOf(lines: readonly RawLine[]): OracleSession {
  const turns = turnsOf(activeBranchOf(lines));
  const agents = new Set(lines.filter((l) => l.isSidechain === true && typeof l.agentId === "string").map((l) => l.agentId as string));
  return assemble(
    turns.map((turn) => roundsOf(turn).map((round) => claudeFigures(round.lines))),
    {
      turnStartMs: turns.map((turn) => timeOf(turn.lines[0]!.timestamp)),
      subagentRuns: agents.size,
      prompts: turns.map((turn) => promptText((turn.lines[0]!.message as Record<string, unknown> | undefined)?.content)),
    },
  );
}

// ------------------------------------------------------------ VS Code local

function localFigures(span: RawLine): OracleRequest | undefined {
  const attrs = isRecord(span.attrs) ? span.attrs : {};
  const input = asCount(attrs.inputTokens);
  const cached = asCount(attrs.cachedTokens);
  const output = asCount(attrs.outputTokens);
  const model = typeof attrs.model === "string" && attrs.model !== "" ? attrs.model : undefined;
  const atMs = typeof span.ts === "number" && Number.isFinite(span.ts) ? span.ts : undefined;
  if (input === undefined || cached === undefined || output === undefined || model === undefined || atMs === undefined || cached > input) return undefined;
  return {
    turn: 0,
    atMs,
    model,
    prompt: input,
    cacheRead: cached,
    output,
    nanoAiu: asFinite(attrs.copilotUsageNanoAiu) ?? null,
    ...(typeof attrs.debugName === "string" ? { agent: attrs.debugName } : {}),
  };
}

// Copilot Chat's debug log: one user_message span per turn, positionally the
// session's turn N (the provider's documented join); spans before the first
// user_message belong to no turn.
export function vscodeLocalSessionOf(envelopes: readonly RawLine[]): OracleSession {
  const turns: RawLine[][] = [];
  for (const envelope of envelopes) {
    if (envelope.type === "user_message") turns.push([envelope]);
    else turns.at(-1)?.push(envelope);
  }
  const agentOf = (span: RawLine) => (isRecord(span.attrs) && typeof span.attrs.debugName === "string" ? span.attrs.debugName : undefined);
  const isMain = (span: RawLine) => span.type === "llm_request" && agentOf(span) === LOCAL_MAIN_AGENT;
  const leftOut: LeftOutRequest[] = turns.flatMap((turn, index) =>
    turn
      .filter((span) => span.type === "llm_request" && !isMain(span))
      .map((span) => {
        const attrs = isRecord(span.attrs) ? span.attrs : {};
        const agent = agentOf(span);
        return { turn: index, cacheRead: asCount(attrs.cachedTokens) ?? null, nanoAiu: asFinite(attrs.copilotUsageNanoAiu) ?? null, ...(agent !== undefined ? { agent } : {}) };
      }),
  );
  return assemble(
    turns.map((turn) => turn.filter(isMain).map(localFigures)),
    {
      turnStartMs: turns.map((turn) => (typeof turn[0]!.ts === "number" ? turn[0]!.ts : undefined)),
      subagentRuns: turns.flat().filter((e) => e.type === "child_session_ref").length,
      prompts: turns.map((turn) => (isRecord(turn[0]!.attrs) && typeof turn[0]!.attrs.content === "string" ? turn[0]!.attrs.content : "")),
    },
    leftOut,
  );
}

// ------------------------------------------------------------- Agent Host

function hostFigures(event: RawLine): OracleRequest | undefined {
  const usage = isRecord(event.data) && isRecord(event.data.usage) ? event.data.usage : undefined;
  if (!usage) return undefined;
  const input = asFinite(usage.inputTokens);
  const read = asFinite(usage.cacheReadTokens);
  const output = asFinite(usage.outputTokens);
  const write = usage.cacheDetailsReported === false ? null : (asFinite(usage.cacheWriteTokens) ?? null);
  const model = typeof usage.model === "string" && usage.model !== "" ? usage.model : undefined;
  const atMs = timeOf(event.timestamp);
  // Copilot's inputTokens holds the reads and writes.
  if (input === undefined || read === undefined || output === undefined || model === undefined || atMs === undefined || read + (write ?? 0) > input) return undefined;
  return { turn: 0, atMs, model, prompt: input, cacheRead: read, output, cacheWrite: write };
}

const mainAgent = (event: RawLine) => event.agentId === undefined || event.agentId === null;

// The Copilot CLI's event log: a turn opens at the main agent's user.message;
// a usage_record with an agentId is a sub-agent's call (D6).
export function agentHostSessionOf(events: readonly RawLine[]): OracleSession {
  const turns: RawLine[][] = [];
  for (const event of events) {
    if (event.type === "user.message" && mainAgent(event)) turns.push([event]);
    else turns.at(-1)?.push(event);
  }
  const subagents = new Set(events.filter((e) => e.type === "session.usage_record" && !mainAgent(e)).map((e) => String(e.agentId)));
  const contentOf = (event: RawLine) => (isRecord(event.data) && typeof event.data.content === "string" ? event.data.content : "");
  return assemble(
    turns.map((turn) => turn.filter((e) => e.type === "session.usage_record" && mainAgent(e)).map(hostFigures)),
    { turnStartMs: turns.map((turn) => timeOf(turn[0]!.timestamp)), subagentRuns: subagents.size, prompts: turns.map((turn) => contentOf(turn[0]!)) },
  );
}

// ------------------------------------------------------- the D12 rebuild

export type Outcome = "hit" | "partial" | "miss";

export function recordedOutcome(cacheRead: number, previousPrompt: number): Outcome {
  if (cacheRead === 0) return "miss";
  return cacheRead >= previousPrompt * 0.99 ? "hit" : "partial";
}

export interface TurnExpectation {
  // Every request's logged cache read: the turn's measured figure.
  loggedRead: number;
  // The same without the session's first request (A3): what the replay's
  // own-model simulation must reproduce within D12's tolerance.
  comparedRead: number;
  // Over the compared requests; undefined when there are none.
  outcome: Outcome | undefined;
  holdsFirstRequest: boolean;
  requests: number;
}

export function turnExpectations(session: OracleSession): Map<number, TurnExpectation> {
  const out = new Map<number, TurnExpectation>();
  const outcomes = new Map<number, Set<Outcome>>();
  session.requests.forEach((request, i) => {
    const turn = out.get(request.turn) ?? { loggedRead: 0, comparedRead: 0, outcome: undefined, holdsFirstRequest: false, requests: 0 };
    turn.loggedRead += request.cacheRead;
    turn.requests += 1;
    if (i === 0) turn.holdsFirstRequest = true;
    else {
      turn.comparedRead += request.cacheRead;
      const seen = outcomes.get(request.turn) ?? new Set<Outcome>();
      seen.add(recordedOutcome(request.cacheRead, session.requests[i - 1]!.prompt));
      outcomes.set(request.turn, seen);
    }
    out.set(request.turn, turn);
  });
  for (const [turn, seen] of outcomes) out.get(turn)!.outcome = seen.has("miss") ? "miss" : seen.has("partial") ? "partial" : "hit";
  // A helper's read is part of the turn's measured figure, never of the chain's.
  for (const helper of session.leftOut) {
    const turn = out.get(helper.turn);
    if (turn) turn.loggedRead += helper.cacheRead ?? 0;
  }
  return out;
}

export function withinTolerance(simulated: number, logged: number, percent: number): boolean {
  return Math.abs(simulated - logged) <= (percent / 100) * logged;
}

// ---------------------------------------------------- the API price rebuild

interface Rates {
  maxInputTokens?: number;
  inputUsdPerM: number;
  cachedInputUsdPerM: number;
  cacheWriteUsdPerM: number | null;
  extendedCacheWriteUsdPerM?: number;
  outputUsdPerM: number;
}

export type OraclePrice = { known: true; usd: number; versionId: string } | { known: false; reason: string };

export function priceClaudeCodeTurn(requests: readonly OracleRequest[], atMs: number, tables: ModelTables): OraclePrice {
  const models = new Set(requests.map((r) => r.model));
  if (models.size !== 1) return { known: false, reason: "mixed-model turn" };
  const model = [...models][0]!;
  const version = tables.priceVersion(model, atMs);
  if (!version) return { known: false, reason: `no price for ${bookModelIds(model).at(-1)}` };
  if (version.tiers.length !== 1) return { known: false, reason: `${version.id} has prompt-length tiers` };
  const tier = version.tiers[0] as unknown as Rates;
  let usd = 0;
  for (const r of requests) {
    const writes = r.cacheWrite ?? 0;
    const oneHour = r.oneHourWrite ?? writes;
    if (oneHour > 0 && tier.extendedCacheWriteUsdPerM === undefined) return { known: false, reason: `${version.id} has no 1-hour write price` };
    const write = tier.cacheWriteUsdPerM ?? tier.inputUsdPerM;
    const extended = tier.extendedCacheWriteUsdPerM ?? write;
    usd += ((r.uncached ?? 0) * tier.inputUsdPerM + r.cacheRead * tier.cachedInputUsdPerM + (writes - oneHour) * write + oneHour * extended + r.output * tier.outputUsdPerM) / 1_000_000;
  }
  return { known: true, usd, versionId: version.id };
}

// ------------------------------------------------------------ the ranking

// What the Compare models view shows first: the cheapest; unknown totals last.
export function rankedModels(entries: ReadonlyArray<{ model: string; value: number | null }>): string[] {
  return [...entries]
    .sort((a, b) => {
      if (a.value === null || b.value === null) return a.value === b.value ? a.model.localeCompare(b.model) : a.value === null ? 1 : -1;
      return a.value - b.value || a.model.localeCompare(b.model);
    })
    .map((e) => e.model);
}

// ------------------------------------------------------------ privacy

// A prompt "leaks" when an answer holds its opening 40 characters (whitespace
// folded), raw or JSON-escaped; shorter prompts can't be told from ordinary words.
const MIN_PROMPT_CHARS = 24;
const SNIPPET_CHARS = 40;

export function leaksIn(answer: string, home: string, prompts: readonly string[]): { homePath: boolean; prompts: number } {
  let leaked = 0;
  for (const prompt of prompts) {
    const folded = prompt.replace(/\s+/g, " ").trim();
    if (folded.length < MIN_PROMPT_CHARS) continue;
    const snippet = folded.slice(0, SNIPPET_CHARS);
    if (answer.includes(snippet) || answer.includes(JSON.stringify(snippet).slice(1, -1))) leaked += 1;
  }
  return { homePath: answer.includes(home), prompts: leaked };
}
