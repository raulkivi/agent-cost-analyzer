// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Plan claude-code-subagents.md §10 (CS16, 1.0 criterion C15): the oracle of the
// real-data check. It takes one Claude Code session's raw lines and the lines of
// each transcript in its `subagents/` folder, and recomputes from the plan's
// rules (§5.4, §6, §13, D1-D17), not from the code, what the product must say:
//   - the main agent's tokens per turn and every run's, each round counted once
//     by `message.id`, `<synthetic>` rounds left out;
//   - which turn each run belongs to (the `Agent` call that started it, or its
//     parent run's turn, or the time of its first line) and which are not
//     counted (off the active branch, D5/D17);
//   - rounds a fork copied from its parent (the main branch, or the parent run's
//     counted rounds) skipped, by `message.id` or `requestId`;
//   - what is unknown, never 0: a missing, unreadable or non-regular transcript,
//     a missing numeric usage field, a nesting deeper than 8 or a cycle, a run
//     nothing links, a folder that can't be read or holds too many files;
//   - the tool calls of the branch and of each readable run, a call id once;
//   - the priced cost of every line (the main agent's, each run's), each on its
//     own model, at the turn's start, from the bundled price book.
// The only imports are the savings oracle's branch, turn and round rules and its
// price tables, themselves independent of the product (see replay-oracle.mts).
import { activeBranchOf, roundsOf, turnsOf, type ModelTables, type RawLine, type Round } from "./savings-oracle.mjs";

export type { RawLine };

export const MAX_RUN_DEPTH = 8;
export const MAX_RUN_FILES = 500;

// A figure that is not known is null, never 0.
export type Count = number | null;

export interface Tokens {
  uncachedInput: Count;
  cacheWrite: Count;
  cacheRead: Count;
  output: Count;
  // The part of cacheWrite written with the 1-hour lifetime.
  extendedCacheWrite: Count;
}

export type UnknownKind =
  | "missing"
  | "not-regular"
  | "unreadable"
  | "missing-field"
  | "too-deep"
  | "unmatched"
  | "not-regular-folder"
  | "folder-unreadable"
  | "too-many";

export type OracleTranscript =
  | { status: "read"; lines: readonly RawLine[] }
  | { status: "missing" | "not-regular-file" | "unreadable" };

export interface OracleRunInput {
  agentId: string;
  // The meta's two links, already validated as ids; absent when the meta is.
  meta?: { toolUseId?: string; parentAgentId?: string };
  transcript: OracleTranscript;
}

export interface OracleSessionInput {
  lines: readonly RawLine[];
  folder: { status: "ok" | "not-regular-folder" | "unreadable" | "too-many" };
  runs: readonly OracleRunInput[];
  // Call ids and agent ids the project's other sessions' folders hold (D7).
  heldElsewhere?: ReadonlySet<string>;
}

export interface OracleRun {
  agentId: string;
  turn: number;
  parentAgentId?: string;
  // 1 = started by the main agent.
  depth: number;
  link: "tool-use-id" | "timestamp";
  known: boolean;
  unknownKind?: UnknownKind;
  // The last round's model; "unknown" for an unknown run.
  model: string;
  rounds: number;
  tokens: Tokens;
  startMs: number | null;
  // The transcript was read and the run is no deeper than the read depth.
  readable: boolean;
}

export interface OracleTurn {
  startMs: number | null;
  own: Tokens;
  ownRounds: number;
  ownModel: string;
  runs: OracleRun[];
  // own + runs, four fields; null where any part is unknown or the session is.
  total: Omit<Tokens, "extendedCacheWrite">;
}

export interface ToolCallFacts {
  main: number;
  byRun: Map<string, number>;
  unreadRuns: string[];
}

export interface OracleSession {
  turns: OracleTurn[];
  runs: OracleRun[];
  offBranchRunIds: string[];
  unknownKinds: UnknownKind[];
  countedElsewhere: number;
  toolCalls: ToolCallFacts;
}

// ------------------------------------------------------------------ raw lines

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const messageOf = (line: RawLine): Record<string, unknown> | undefined => (isRecord(line.message) ? line.message : undefined);
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const RUN_TOOLS: ReadonlySet<string> = new Set(["Agent", "Task"]);

function blocksOf(line: RawLine): Record<string, unknown>[] {
  const content = messageOf(line)?.content;
  return Array.isArray(content) ? content.filter(isRecord) : [];
}

const timeOf = (value: unknown): number | null => {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
};

// ------------------------------------------------------------------- tokens

const NONE: Tokens = { uncachedInput: null, cacheWrite: null, cacheRead: null, output: null, extendedCacheWrite: null };
const ZERO: Tokens = { uncachedInput: 0, cacheWrite: 0, cacheRead: 0, output: 0, extendedCacheWrite: 0 };
const FOUR = ["uncachedInput", "cacheWrite", "cacheRead", "output"] as const;

const numeric = (value: unknown): Count => (typeof value === "number" ? value : null);

function usageOf(round: Round): Record<string, unknown> | undefined {
  return round.lines.map((line) => messageOf(line)?.usage).find(isRecord);
}

function roundTokens(round: Round): Tokens {
  const usage = usageOf(round);
  const write = numeric(usage?.cache_creation_input_tokens);
  const split = isRecord(usage?.cache_creation) ? numeric(usage.cache_creation.ephemeral_1h_input_tokens) : null;
  return {
    uncachedInput: numeric(usage?.input_tokens),
    cacheWrite: write,
    cacheRead: numeric(usage?.cache_read_input_tokens),
    output: numeric(usage?.output_tokens),
    // A round that wrote nothing has no 1-hour part even without the split.
    extendedCacheWrite: split ?? (usage?.cache_creation_input_tokens === 0 ? 0 : null),
  };
}

const add = (a: Count, b: Count): Count => (a === null || b === null ? null : a + b);

function sumRounds(rounds: readonly Round[]): Tokens {
  return rounds.map(roundTokens).reduce(
    (sum, t) => ({
      uncachedInput: add(sum.uncachedInput, t.uncachedInput),
      cacheWrite: add(sum.cacheWrite, t.cacheWrite),
      cacheRead: add(sum.cacheRead, t.cacheRead),
      output: add(sum.output, t.output),
      extendedCacheWrite: add(sum.extendedCacheWrite, t.extendedCacheWrite),
    }),
    ZERO,
  );
}

const modelOfRounds = (rounds: readonly Round[]): string => {
  const last = rounds.at(-1);
  return last?.lines.map((line) => messageOf(line)?.model).find((m): m is string => typeof m === "string") ?? "unknown";
};

const requestIdOf = (round: Round): string | undefined => round.lines.map((line) => line.requestId).find((id): id is string => typeof id === "string");

// The ids that tell one billed request from another, for fork copies.
function idsOfAssistantLines(lines: readonly RawLine[]): Set<string> {
  const ids = new Set<string>();
  for (const line of lines) {
    if (line.type !== "assistant") continue;
    const id = messageOf(line)?.id;
    if (typeof id === "string") ids.add(id);
    if (typeof line.requestId === "string") ids.add(line.requestId);
  }
  return ids;
}

// ------------------------------------------------------------------ the calls

interface AgentCall {
  callId: string;
  failed: boolean;
  agentId?: string;
}

function agentCallIds(lines: readonly RawLine[]): string[] {
  return lines
    .filter((line) => line.type === "assistant")
    .flatMap(blocksOf)
    .filter((block) => block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string" && RUN_TOOLS.has(block.name))
    .map((block) => block.id as string);
}

// Each run-starting call with what its result says: a failed launch, and the
// agent id the result names (only when the line holds that one result).
function agentCallsIn(lines: readonly RawLine[]): Map<string, AgentCall> {
  const calls = new Map<string, AgentCall>(agentCallIds(lines).map((callId) => [callId, { callId, failed: false }]));
  for (const line of lines) {
    if (line.type !== "user") continue;
    const results = blocksOf(line).filter((block) => block.type === "tool_result");
    const named = isRecord(line.toolUseResult) ? line.toolUseResult.agentId : undefined;
    const agentId = results.length === 1 && typeof named === "string" && ID.test(named) ? named : undefined;
    for (const block of results) {
      const call = typeof block.tool_use_id === "string" ? calls.get(block.tool_use_id) : undefined;
      if (call === undefined) continue;
      if (block.is_error === true) call.failed = true;
      if (agentId !== undefined) call.agentId = agentId;
    }
  }
  return calls;
}

// ------------------------------------------------------------------ placement

type Placement =
  | { kind: "turn"; turn: number; link: OracleRun["link"]; callId?: string; ancestors: string[] }
  | { kind: "off-branch" }
  | { kind: "cycle" }
  | { kind: "unmatched" };

// The one turn whose window (its first line to the next turn's) holds `at`.
function turnAt(starts: readonly (number | null)[], at: number): number | null {
  let match: number | null = null;
  for (let i = 0; i < starts.length; i += 1) {
    const from = starts[i]!;
    const to = i + 1 < starts.length ? starts[i + 1]! : Number.POSITIVE_INFINITY;
    if (from === null || to === null || !(from <= at && at < to)) continue;
    if (match !== null) return null;
    match = i;
  }
  return match;
}

const transcriptKind = (t: OracleTranscript): UnknownKind | undefined =>
  t.status === "missing"
    ? "missing"
    : t.status === "not-regular-file"
      ? "not-regular"
      : t.status === "unreadable" || t.lines.length === 0
        ? "unreadable"
        : undefined;

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function firstTimestamp(t: OracleTranscript): number | null {
  if (t.status !== "read") return null;
  for (const line of t.lines) {
    const ms = timeOf(line.timestamp);
    if (ms !== null) return ms;
  }
  return null;
}

// The run's own start for ordering: the first line with a UTC timestamp.
function startOf(t: OracleTranscript): number | null {
  if (t.status !== "read") return null;
  for (const line of t.lines) {
    if (typeof line.timestamp === "string" && ISO_UTC.test(line.timestamp) && timeOf(line.timestamp) !== null) return timeOf(line.timestamp);
  }
  return null;
}

// ---------------------------------------------------------------- the session

export function oracleSession(input: OracleSessionInput): OracleSession {
  const branch = activeBranchOf(input.lines);
  const rawTurns = turnsOf(branch);
  const turns: OracleTurn[] = rawTurns.map((t) => {
    const rounds = roundsOf(t);
    return {
      startMs: timeOf(t.lines[0]!.timestamp),
      own: sumRounds(rounds),
      ownRounds: rounds.length,
      ownModel: modelOfRounds(rounds),
      runs: [],
      total: { uncachedInput: null, cacheWrite: null, cacheRead: null, output: null },
    };
  });

  const onBranch = agentCallsIn(branch);
  const turnOfCall = new Map<string, number>();
  rawTurns.forEach((t, index) => agentCallIds(t.lines).forEach((id) => turnOfCall.set(id, index)));
  const callOfAgent = new Map<string, string>();
  for (const call of onBranch.values()) if (call.agentId !== undefined) callOfAgent.set(call.agentId, call.callId);
  const offBranchCalls = new Set<string>();
  const offBranchAgents = new Set<string>();
  for (const call of agentCallsIn(input.lines).values()) {
    if (onBranch.has(call.callId)) continue;
    offBranchCalls.add(call.callId);
    if (call.agentId !== undefined) offBranchAgents.add(call.agentId);
  }

  const unknownKinds = new Set<UnknownKind>();
  const runs: OracleRun[] = [];
  const offBranchRunIds: string[] = [];
  let countedElsewhere = 0;

  const unknownRun = (agentId: string, turn: number, kind: UnknownKind, extra: Partial<OracleRun> = {}): OracleRun => ({
    agentId,
    turn,
    depth: 1,
    link: "tool-use-id",
    known: false,
    unknownKind: kind,
    model: "unknown",
    rounds: 0,
    tokens: { ...NONE },
    startMs: null,
    readable: false,
    ...extra,
  });
  const place = (run: OracleRun) => {
    runs.push(run);
    turns[run.turn]?.runs.push(run);
    if (run.unknownKind !== undefined) unknownKinds.add(run.unknownKind);
  };

  // A call that should have a run and has none: its run is unknown, never absent.
  const placeCalls = (claimed: ReadonlySet<string>, kindFor: () => UnknownKind) => {
    let counter = 0;
    for (const call of onBranch.values()) {
      const turn = turnOfCall.get(call.callId);
      if (turn === undefined || call.failed || claimed.has(call.callId)) continue;
      const held = input.heldElsewhere;
      if (held !== undefined && (held.has(call.callId) || (call.agentId !== undefined && held.has(call.agentId)))) {
        countedElsewhere += 1;
        continue;
      }
      counter += 1;
      place(unknownRun(ID.test(call.callId) ? call.callId : `missing-run-${counter}`, turn, kindFor()));
    }
  };

  if (input.folder.status !== "ok") {
    const kind: UnknownKind = input.folder.status === "unreadable" ? "folder-unreadable" : input.folder.status;
    unknownKinds.add(kind);
    placeCalls(new Set(), () => kind);
  } else {
    const byId = new Map(input.runs.map((run) => [run.agentId, run]));
    const turnStarts = turns.map((t) => t.startMs);
    const memo = new Map<string, Placement>();

    const placementOf = (run: OracleRunInput, path: ReadonlySet<string>): Placement => {
      const cached = memo.get(run.agentId);
      if (cached !== undefined) return cached;
      const placement = linked(run) ?? viaParent(run, path) ?? byTime(run);
      memo.set(run.agentId, placement);
      return placement;
    };
    const linked = (run: OracleRunInput): Placement | undefined => {
      const toolUseId = run.meta?.toolUseId;
      const callId = toolUseId !== undefined && turnOfCall.has(toolUseId) ? toolUseId : callOfAgent.get(run.agentId);
      const turn = callId === undefined ? undefined : turnOfCall.get(callId);
      if (callId !== undefined && turn !== undefined) return { kind: "turn", turn, link: "tool-use-id", callId, ancestors: [] };
      if ((toolUseId !== undefined && offBranchCalls.has(toolUseId)) || offBranchAgents.has(run.agentId)) return { kind: "off-branch" };
      return undefined;
    };
    const viaParent = (run: OracleRunInput, path: ReadonlySet<string>): Placement | undefined => {
      const parentId = run.meta?.parentAgentId;
      const parent = parentId === undefined ? undefined : byId.get(parentId);
      if (parentId === undefined || parent === undefined) return undefined;
      if (parentId === run.agentId || path.has(parentId)) return { kind: "cycle" };
      const above = placementOf(parent, new Set([...path, run.agentId]));
      return above.kind === "turn" ? { kind: "turn", turn: above.turn, link: above.link, ancestors: [parentId, ...above.ancestors] } : above;
    };
    const byTime = (run: OracleRunInput): Placement => {
      if (transcriptKind(run.transcript) !== undefined) return { kind: "unmatched" };
      const start = firstTimestamp(run.transcript);
      const turn = start === null ? null : turnAt(turnStarts, start);
      return turn === null ? { kind: "unmatched" } : { kind: "turn", turn, link: "timestamp", ancestors: [] };
    };

    const placed: { run: OracleRunInput; placement: Extract<Placement, { kind: "turn" }> }[] = [];
    for (const run of input.runs) {
      const placement = placementOf(run, new Set());
      if (placement.kind === "turn") placed.push({ run, placement });
      else if (placement.kind === "off-branch") offBranchRunIds.push(run.agentId);
      else unknownKinds.add(placement.kind === "cycle" ? "too-deep" : "unmatched");
    }

    // Ancestors first: a nested fork skips the main branch's rounds and every
    // run above it's counted ones.
    const countedIds = new Map<string, ReadonlySet<string>>();
    const mainIds = idsOfAssistantLines(branch);
    const claimed = new Set<string>();
    for (const { run, placement } of [...placed].sort((a, b) => a.placement.ancestors.length - b.placement.ancestors.length)) {
      const depth = placement.ancestors.length + 1;
      const common = {
        agentId: run.agentId,
        turn: placement.turn,
        depth,
        link: placement.link,
        ...(run.meta?.parentAgentId === undefined ? {} : { parentAgentId: run.meta.parentAgentId }),
      };
      if (placement.callId !== undefined) claimed.add(placement.callId);
      const problem = depth > MAX_RUN_DEPTH ? "too-deep" : transcriptKind(run.transcript);
      if (problem !== undefined || run.transcript.status !== "read") {
        place(unknownRun(run.agentId, placement.turn, problem ?? "unreadable", { ...common, readable: false }));
        continue;
      }
      const skip = new Set(mainIds);
      for (const ancestor of placement.ancestors) for (const id of countedIds.get(ancestor) ?? []) skip.add(id);
      const rounds = roundsOf({ lines: [...run.transcript.lines] }).filter((round) => {
        const requestId = requestIdOf(round);
        return !skip.has(round.id) && !(requestId !== undefined && skip.has(requestId));
      });
      countedIds.set(run.agentId, new Set(rounds.flatMap((round) => [round.id, ...(requestIdOf(round) === undefined ? [] : [requestIdOf(round)!])])));
      const tokens = sumRounds(rounds);
      const known = FOUR.every((field) => tokens[field] !== null);
      place({
        ...common,
        known,
        ...(known ? {} : { unknownKind: "missing-field" as const }),
        model: modelOfRounds(rounds),
        rounds: rounds.length,
        tokens: known ? tokens : { ...NONE },
        startMs: startOf(run.transcript),
        readable: true,
      });
    }
    placeCalls(claimed, () => "missing");
  }

  runs.sort((a, b) => a.turn - b.turn || (a.startMs ?? Infinity) - (b.startMs ?? Infinity) || a.agentId.localeCompare(b.agentId));
  for (const turn of turns) turn.runs.sort((a, b) => (a.startMs ?? Infinity) - (b.startMs ?? Infinity) || a.agentId.localeCompare(b.agentId));

  for (const turn of turns) {
    for (const field of FOUR) turn.total[field] = turn.runs.reduce<Count>((sum, run) => add(sum, run.tokens[field]), turn.own[field]);
  }
  // A session-level unknown belongs to no turn, yet no total of the session may
  // stay known: the first turn that made a request carries it.
  if (unknownKinds.size > 0 && turns.length > 0) {
    const carrier = turns.findIndex((t) => t.ownRounds !== 0 || t.own.output !== null);
    for (const field of FOUR) turns[carrier === -1 ? 0 : carrier]!.total[field] = null;
  }

  return {
    turns,
    runs,
    offBranchRunIds,
    unknownKinds: [...unknownKinds],
    countedElsewhere,
    toolCalls: toolCallFacts(rawTurns.map((t) => t.lines), runs, input),
  };
}

// ------------------------------------------------------------------ tool calls

const toolUseBlocks = (lines: readonly RawLine[]): Record<string, unknown>[] =>
  lines
    .filter((line) => line.type === "assistant" && typeof messageOf(line)?.id === "string")
    .flatMap(blocksOf)
    .filter((block) => block.type === "tool_use");

// The main agent's calls, then each readable run's: outer runs before inner
// ones, a call id owned by the first log that holds it (a fork repeats its
// parent's), calls without an id always counted.
function toolCallFacts(turnLines: readonly (readonly RawLine[])[], runs: readonly OracleRun[], input: OracleSessionInput): ToolCallFacts {
  const mainBlocks = turnLines.flatMap(toolUseBlocks);
  const counted = new Set(mainBlocks.flatMap((block) => (typeof block.id === "string" ? [block.id] : [])));
  const byRun = new Map<string, number>();
  const transcripts = new Map(input.runs.map((run) => [run.agentId, run.transcript]));
  const unreadRuns: string[] = [];
  for (const run of [...runs].sort((a, b) => a.depth - b.depth)) {
    const transcript = transcripts.get(run.agentId);
    if (!run.readable || transcript === undefined || transcript.status !== "read") {
      unreadRuns.push(run.agentId);
      continue;
    }
    let kept = 0;
    for (const block of toolUseBlocks(transcript.lines)) {
      if (typeof block.id === "string") {
        if (counted.has(block.id)) continue;
        counted.add(block.id);
      }
      kept += 1;
    }
    byRun.set(run.agentId, kept);
  }
  return { main: mainBlocks.length, byRun, unreadRuns: unreadRuns.sort() };
}

export function toolCallCounts(session: OracleSession): ToolCallFacts & { subagents: number } {
  return { ...session.toolCalls, subagents: [...session.toolCalls.byRun.values()].reduce((a, b) => a + b, 0) };
}

// --------------------------------------------------------------------- price

interface Rates {
  inputUsdPerM: number;
  cachedInputUsdPerM: number;
  cacheWriteUsdPerM: number | null;
  extendedCacheWriteUsdPerM?: number;
  outputUsdPerM: number;
}

export type PricedLines = { known: true; usd: number; lines: number } | { known: false; reason: string };

function priceLine(model: string, t: Tokens, rounds: number, atMs: number, tables: ModelTables): number | string {
  if (FOUR.some((field) => t[field] === null)) return "a figure of the line is unknown";
  const [uncached, write, read, output] = [t.uncachedInput!, t.cacheWrite!, t.cacheRead!, t.output!];
  // The log records no model for a line with no request: it can't be priced, even at no tokens.
  if (model === "unknown") return "the log records no model for the line";
  const version = tables.priceVersion(model, atMs);
  if (!version) return `no price for ${model}`;
  const prompt = uncached + write + read;
  const tiers = version.tiers as unknown as (Rates & { maxInputTokens?: number })[];
  const rates = tiers.find((tier) => tier.maxInputTokens === undefined || prompt <= tier.maxInputTokens) ?? tiers.at(-1)!;
  // A prompt-length tier is chosen per request: the log's sum of several requests
  // can't say which, unless the sum itself is in the first tier (each request is smaller).
  if (tiers.length > 1 && rounds !== 1 && rates !== tiers[0]) return `${version.id} has prompt-length tiers and the line made ${rounds} requests`;
  // Writes the log doesn't split count as 1-hour (Claude Code's lifetime).
  const extended = Math.min(t.extendedCacheWrite ?? write, write);
  if (extended > 0 && rates.extendedCacheWriteUsdPerM === undefined) return `${version.id} has no 1-hour write price`;
  const writeRate = rates.cacheWriteUsdPerM ?? rates.inputUsdPerM;
  return (uncached * rates.inputUsdPerM + read * rates.cachedInputUsdPerM + (write - extended) * writeRate + extended * (rates.extendedCacheWriteUsdPerM ?? writeRate) + output * rates.outputUsdPerM) / 1_000_000;
}

// Per turn: its priced cost (null when any of its lines can't be priced) and
// the part the runs' lines make of it.
export function pricedTurns(session: OracleSession, tables: ModelTables): { usd: number | null; runUsd: number }[] {
  const firstStart = session.turns.map((t) => t.startMs).find((ms): ms is number => ms !== null);
  return session.turns.map((turn) => {
    const at = turn.startMs ?? firstStart;
    const line = (model: string, tokens: Tokens, rounds: number) => (at === undefined ? "no turn has a time" : priceLine(model, tokens, rounds, at, tables));
    const own = line(turn.ownModel, turn.own, turn.ownRounds);
    const runs = turn.runs.map((run) => line(run.model, run.tokens, run.rounds));
    const runUsd = runs.reduce<number>((sum, r) => sum + (typeof r === "number" ? r : 0), 0);
    const all = [own, ...runs];
    return all.some((p) => typeof p === "string") ? { usd: null, runUsd } : { usd: all.reduce<number>((s, p) => s + (p as number), 0), runUsd };
  });
}

// Every line of every turn (the main agent's own, then each run's) priced on
// its own model at the turn's start; unknown when any line is, as the product's.
export function pricedLines(session: OracleSession, tables: ModelTables): PricedLines {
  const firstStart = session.turns.map((t) => t.startMs).find((ms): ms is number => ms !== null);
  let usd = 0;
  let lines = 0;
  for (const turn of session.turns) {
    const at = turn.startMs ?? firstStart;
    const parts = [{ model: turn.ownModel, tokens: turn.own, rounds: turn.ownRounds }, ...turn.runs.map((run) => ({ model: run.model, tokens: run.tokens, rounds: run.rounds }))];
    for (const part of parts) {
      const priced = at === undefined ? "no turn has a time" : priceLine(part.model, part.tokens, part.rounds, at, tables);
      if (typeof priced === "string") return { known: false, reason: priced };
      usd += priced;
      lines += 1;
    }
  }
  return { known: true, usd, lines };
}
