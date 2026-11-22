// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// 1.0 criterion C15 as the real-data checks need it: which Claude Code
// subagent runs a session's turns include, and each run's tokens. An independent
// oracle that reads raw JSONL and shares no code with the product's readers
// (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/claude-code-subagents.md §5.4, §6, D1 to D8 and D17). Only the
// two real-data oracles (replay, cost by project) import it.
//
// Rules, from the plan (not from the code):
//   - a run is a pair of files in <session>/subagents/: agent-<id>.jsonl and
//     agent-<id>.meta.json (bare names only; anything else is ignored);
//   - it belongs whole to the turn of the active branch whose Agent call
//     started it (D1): linked by meta.toolUseId, else by the call result's
//     agentId; a nested run (meta.parentAgentId) follows its parent run, to
//     depth 8; a run nothing names is matched by the time of its first line
//     to the one turn window that holds it (D6);
//   - a run whose Agent call is off the active branch is not counted (D5, D17);
//   - a round is a distinct message.id (<synthetic> left out); a round whose
//     message.id or requestId the session's branch or an ancestor run already
//     counted is a fork copy and skipped (D4);
//   - an Agent call on the branch that did not fail (is_error) and has no run
//     is a missing run: its turn is unknown (D8, §6); one that another session
//     of the project holds is neither (D7);
//   - what can't be read, placed or summed makes the turn, or the whole
//     session (its first turn), unknown; never a smaller known figure.
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseJsonl, type RawLine } from "./savings-oracle.mjs";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const count = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined);
const str = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);
const messageOf = (line: RawLine): Record<string, unknown> | undefined => (isRecord(line.message) ? line.message : undefined);

export const MAX_RUN_DEPTH = 8;
const RUN_TOOLS = new Set(["Agent", "Task"]);
const FILE = /^agent-([A-Za-z0-9]{1,64})\.(jsonl|meta\.json)$/;

// ------------------------------------------------------------------- the folder

export interface RawRun {
  agentId: string;
  toolUseId?: string;
  parentAgentId?: string;
  // null: no transcript, or one that is not a regular readable file or has no line.
  lines: RawLine[] | null;
}

const isRegularFile = (file: string): boolean => {
  try {
    return lstatSync(file).isFile();
  } catch {
    return false;
  }
};

function metaOf(file: string): { toolUseId?: string; parentAgentId?: string } {
  if (!isRegularFile(file)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf-8"));
    return isRecord(parsed) ? { toolUseId: str(parsed.toolUseId), parentAgentId: str(parsed.parentAgentId) } : {};
  } catch {
    return {};
  }
}

// A session's runs, from <session file without .jsonl>/subagents/. A folder that
// is not a real directory holds none the product may read: the oracle reads a
// view the check built, whose folders are real.
export function readRunFolder(sessionFile: string): RawRun[] {
  const dir = path.join(sessionFile.replace(/\.jsonl$/i, ""), "subagents");
  if (!existsSync(dir) || !lstatSync(dir).isDirectory()) return [];
  const ids = new Set<string>();
  for (const name of readdirSync(dir)) {
    const match = FILE.exec(name);
    if (match) ids.add(match[1]!);
  }
  return [...ids].sort().map((agentId) => {
    const meta = metaOf(path.join(dir, `agent-${agentId}.meta.json`));
    const transcript = path.join(dir, `agent-${agentId}.jsonl`);
    const lines = isRegularFile(transcript) ? parseJsonl(readFileSync(transcript, "utf-8")) : [];
    return { agentId, ...(meta.toolUseId ? { toolUseId: meta.toolUseId } : {}), ...(meta.parentAgentId ? { parentAgentId: meta.parentAgentId } : {}), lines: lines.length > 0 ? lines : null };
  });
}

// D7: the call ids and agent ids of the runs the project's other sessions hold.
export function idsHeldByOtherSessions(sessionFile: string): Set<string> {
  const ids = new Set<string>();
  const dir = path.dirname(sessionFile);
  for (const name of readdirSync(dir)) {
    const other = path.join(dir, name);
    if (!/\.jsonl$/i.test(name) || other === sessionFile) continue;
    for (const run of readRunFolder(other)) {
      ids.add(run.agentId);
      if (run.toolUseId) ids.add(run.toolUseId);
    }
  }
  return ids;
}

// ---------------------------------------------------------------------- rounds

export interface RunTokens {
  uncached: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  // The 1-hour part of the writes; null when a round with writes doesn't split them.
  cacheWrite1h: number | null;
}

export interface PlacedRun {
  agentId: string;
  turn: number;
  model: string | null;
  rounds: number;
  // null: a round lacks a count.
  tokens: RunTokens | null;
}

interface Round {
  id: string;
  requestId?: string;
  message: Record<string, unknown>;
}

function roundsOf(lines: readonly RawLine[]): Round[] {
  const rounds = new Map<string, Round>();
  for (const line of lines) {
    const message = messageOf(line);
    const id = line.type === "assistant" ? str(message?.id) : undefined;
    if (id === undefined || message === undefined || message.model === "<synthetic>") continue;
    const round = rounds.get(id) ?? { id, message };
    if (round.requestId === undefined && str(line.requestId) !== undefined) round.requestId = str(line.requestId);
    rounds.set(id, round);
  }
  return [...rounds.values()];
}

function idsOfAssistantLines(lines: readonly RawLine[]): Set<string> {
  const ids = new Set<string>();
  for (const line of lines) {
    if (line.type !== "assistant") continue;
    const id = str(messageOf(line)?.id);
    if (id !== undefined) ids.add(id);
    const request = str(line.requestId);
    if (request !== undefined) ids.add(request);
  }
  return ids;
}

function tokensOf(rounds: readonly Round[]): RunTokens | null {
  const sum: RunTokens = { uncached: 0, cacheRead: 0, cacheWrite: 0, output: 0, cacheWrite1h: 0 };
  for (const { message } of rounds) {
    const usage = isRecord(message.usage) ? message.usage : {};
    const [input, read, write, output] = [count(usage.input_tokens), count(usage.cache_read_input_tokens), count(usage.cache_creation_input_tokens), count(usage.output_tokens)];
    if (input === undefined || read === undefined || write === undefined || output === undefined) return null;
    const split = isRecord(usage.cache_creation) ? count(usage.cache_creation.ephemeral_1h_input_tokens) : undefined;
    sum.uncached += input;
    sum.cacheRead += read;
    sum.cacheWrite += write;
    sum.output += output;
    sum.cacheWrite1h = sum.cacheWrite1h === null ? null : split !== undefined ? sum.cacheWrite1h + split : write === 0 ? sum.cacheWrite1h : null;
  }
  return sum;
}

// ------------------------------------------------------------------ the calls

interface Call {
  id: string;
  failed: boolean;
  agentId?: string;
}

function callsIn(lines: readonly RawLine[]): Map<string, Call> {
  const calls = new Map<string, Call>();
  for (const line of lines) {
    const content = messageOf(line)?.content;
    if (line.type !== "assistant" || !Array.isArray(content)) continue;
    for (const block of content) {
      if (isRecord(block) && block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string" && RUN_TOOLS.has(block.name)) calls.set(block.id, { id: block.id, failed: false });
    }
  }
  for (const line of lines) {
    const content = messageOf(line)?.content;
    if (line.type !== "user" || !Array.isArray(content)) continue;
    const results = content.filter((block) => isRecord(block) && block.type === "tool_result");
    // One toolUseResult per line: with several results in a line it names none of them.
    const agentId = isRecord(line.toolUseResult) && results.length === 1 ? str(line.toolUseResult.agentId) : undefined;
    for (const result of results) {
      const call = calls.get(String((result as Record<string, unknown>).tool_use_id));
      if (!call) continue;
      if ((result as Record<string, unknown>).is_error === true) call.failed = true;
      if (agentId !== undefined) call.agentId = agentId;
    }
  }
  return calls;
}

// ------------------------------------------------------------------ placement

export interface TurnWindow {
  // Index into the branch of the turn's opening line, and that line's time.
  index: number;
  ms: number | null;
}

export interface PlaceInput {
  // The active branch, root to leaf, and every line of the session file.
  branch: readonly RawLine[];
  sessionLines: readonly RawLine[];
  turns: readonly TurnWindow[];
  runs: readonly RawRun[];
  heldElsewhere?: ReadonlySet<string>;
}

export interface TurnRuns {
  runs: PlacedRun[];
  unknown: boolean;
}

export interface SessionRuns {
  byTurn: Map<number, TurnRuns>;
  // A run or transcript that no turn can hold: the session's first turn is unknown.
  sessionUnknown: boolean;
  // Runs the session's turns hold: placed, known or not, and one unknown run for each missing one.
  runCount: number;
}

type Where = { turn: number; callId?: string; ancestors: string[] } | "off-branch" | "cycle" | "unmatched";

function turnAtIndex(turns: readonly TurnWindow[], index: number): number | undefined {
  let found: number | undefined;
  turns.forEach((turn, i) => {
    if (turn.index <= index) found = i;
  });
  return found;
}

function turnAtTime(turns: readonly TurnWindow[], at: number): number | null {
  let match: number | null = null;
  for (let i = 0; i < turns.length; i++) {
    const from = turns[i]!.ms;
    const to = i + 1 < turns.length ? turns[i + 1]!.ms : Number.POSITIVE_INFINITY;
    if (from === null || to === null || !(from <= at && at < to)) continue;
    if (match !== null) return null;
    match = i;
  }
  return match;
}

export function placeRuns(input: PlaceInput): SessionRuns {
  const { branch, sessionLines, turns, runs } = input;
  const onBranch = callsIn(branch);
  const everywhere = callsIn(sessionLines);
  const turnOfCall = new Map<string, number>();
  branch.forEach((line, index) => {
    const content = messageOf(line)?.content;
    if (line.type !== "assistant" || !Array.isArray(content)) return;
    for (const block of content) {
      if (isRecord(block) && block.type === "tool_use" && typeof block.id === "string" && onBranch.has(block.id)) {
        const turn = turnAtIndex(turns, index);
        if (turn !== undefined) turnOfCall.set(block.id, turn);
      }
    }
  });
  const callOfAgent = new Map<string, string>();
  for (const call of onBranch.values()) if (call.agentId !== undefined) callOfAgent.set(call.agentId, call.id);
  const offBranchCalls = new Set([...everywhere.keys()].filter((id) => !onBranch.has(id)));
  const offBranchAgents = new Set([...everywhere.values()].filter((c) => !onBranch.has(c.id) && c.agentId !== undefined).map((c) => c.agentId!));
  const byId = new Map(runs.map((run) => [run.agentId, run]));

  const memo = new Map<string, Where>();
  const whereOf = (run: RawRun, path: ReadonlySet<string> = new Set()): Where => {
    const known = memo.get(run.agentId);
    if (known !== undefined) return known;
    const callId = run.toolUseId !== undefined && turnOfCall.has(run.toolUseId) ? run.toolUseId : callOfAgent.get(run.agentId);
    const linked = callId === undefined ? undefined : turnOfCall.get(callId);
    let where: Where | undefined;
    if (callId !== undefined && linked !== undefined) where = { turn: linked, callId, ancestors: [] };
    else if ((run.toolUseId !== undefined && offBranchCalls.has(run.toolUseId)) || offBranchAgents.has(run.agentId)) where = "off-branch";
    else {
      const parent = run.parentAgentId === undefined ? undefined : byId.get(run.parentAgentId);
      if (parent !== undefined) {
        if (parent.agentId === run.agentId || path.has(parent.agentId)) where = "cycle";
        else {
          const up = whereOf(parent, new Set([...path, run.agentId]));
          where = typeof up === "object" ? { turn: up.turn, ancestors: [parent.agentId, ...up.ancestors] } : up;
        }
      }
    }
    if (where === undefined) {
      const first = run.lines?.map((l) => (typeof l.timestamp === "string" ? Date.parse(l.timestamp) : Number.NaN)).find((ms) => !Number.isNaN(ms));
      const turn = first === undefined ? null : turnAtTime(turns, first);
      where = run.lines === null || turn === null ? "unmatched" : { turn, ancestors: [] };
    }
    memo.set(run.agentId, where);
    return where;
  };

  const byTurn = new Map<number, TurnRuns>();
  const turnOf = (turn: number): TurnRuns => {
    const entry = byTurn.get(turn) ?? { runs: [], unknown: false };
    byTurn.set(turn, entry);
    return entry;
  };
  let sessionUnknown = false;
  let runCount = 0;
  const placed: { run: RawRun; turn: number; callId?: string; ancestors: string[] }[] = [];
  for (const run of runs) {
    const where = whereOf(run);
    if (where === "off-branch") continue;
    if (where === "cycle" || where === "unmatched") sessionUnknown = true;
    else placed.push({ run, ...where });
  }

  // Ancestors first: a nested fork repeats rounds of the runs above it.
  const counted = new Map<string, Set<string>>();
  const sessionIds = idsOfAssistantLines(branch);
  const claimed = new Set<string>();
  for (const { run, turn, callId, ancestors } of [...placed].sort((a, b) => a.ancestors.length - b.ancestors.length)) {
    runCount += 1;
    if (callId !== undefined) claimed.add(callId);
    const entry = turnOf(turn);
    if (ancestors.length + 1 > MAX_RUN_DEPTH || run.lines === null) {
      entry.unknown = true;
      continue;
    }
    const skip = new Set(sessionIds);
    for (const ancestor of ancestors) for (const id of counted.get(ancestor) ?? []) skip.add(id);
    const rounds = roundsOf(run.lines).filter((round) => !skip.has(round.id) && !(round.requestId !== undefined && skip.has(round.requestId)));
    counted.set(run.agentId, new Set(rounds.flatMap((round) => (round.requestId === undefined ? [round.id] : [round.id, round.requestId]))));
    const tokens = tokensOf(rounds);
    if (tokens === null) entry.unknown = true;
    entry.runs.push({ agentId: run.agentId, turn, model: rounds.length > 0 ? str(rounds.at(-1)!.message.model) ?? null : null, rounds: rounds.length, tokens });
  }

  // D8 and D7: a call that didn't fail and has no run of its own is a missing run.
  for (const call of onBranch.values()) {
    const turn = turnOfCall.get(call.id);
    if (turn === undefined || call.failed || claimed.has(call.id)) continue;
    if (input.heldElsewhere?.has(call.id) || (call.agentId !== undefined && input.heldElsewhere?.has(call.agentId))) continue;
    turnOf(turn).unknown = true;
    runCount += 1; // the turn holds an unknown run in its place
  }
  return { byTurn, sessionUnknown, runCount };
}
