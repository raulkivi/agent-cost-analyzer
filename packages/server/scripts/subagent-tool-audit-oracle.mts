// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// ST15 (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/subagent-tool-audit.md §11): an independent oracle for the
// tool-call audit's subagent calls. It reads raw log text and imports nothing:
// no product code, no other oracle (subagent-tool-audit-oracle.test.mts checks
// that). Rules are the plan's (§4, §6, §7), restated here, not copied:
//   - classic Copilot Chat: a `tool_call` span after the log's first
//     `user_message` is a call; `status` ok = succeeded, error = failed (a
//     trimmed "canceled" error text = canceled), anything else = unknown. A
//     `child_session_ref` names a run's own log next to main.jsonl; a file no
//     ref names is placed by time when it says it belongs to this session. A
//     call id counts once: the parent's first, then runs in turn order;
//   - Agent Host (Copilot CLI events.jsonl): a call is a distinct toolCallId
//     in an `assistant.message` request or a `tool.execution_start`; one whose
//     event carries an `agentId` is a subagent run's, the run named by the
//     call that started it (`parentToolCallId`). A refused permission =
//     denied, else a completion's `success` = succeeded or failed, else
//     interrupted when the call's turn has an `abort`, else unknown.
// It never keeps a result, only counts, ids, enum values and (to prove they
// stay out of MCP output) the input text of subagent-starting calls.

export interface OutcomeCounts {
  toolCalls: number;
  succeeded: number;
  failed: number;
  interrupted: number;
  denied: number;
  unknown: number;
  canceled: number;
}

export const emptyCounts = (): OutcomeCounts => ({ toolCalls: 0, succeeded: 0, failed: 0, interrupted: 0, denied: 0, unknown: 0, canceled: 0 });

export type OutcomeKey = Exclude<keyof OutcomeCounts, "toolCalls">;

function tally(counts: OutcomeCounts, key: OutcomeKey): void {
  counts.toolCalls += 1;
  counts[key] += 1;
}

export function addCounts(a: OutcomeCounts, b: OutcomeCounts): OutcomeCounts {
  const sum = emptyCounts();
  for (const key of Object.keys(sum) as (keyof OutcomeCounts)[]) sum[key] = a[key] + b[key];
  return sum;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const finite = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

// Lines that don't parse to an object are skipped (a live file's last line).
export function parseJsonlObjects(text: string): Obj[] {
  const out: Obj[] = [];
  for (const raw of text.split("\n")) {
    if (raw.trim() === "") continue;
    try {
      const v: unknown = JSON.parse(raw);
      if (isObj(v)) out.push(v);
    } catch {
      // skipped
    }
  }
  return out;
}

const SUBAGENT_TOOLS = new Set(["task", "agent", "runsubagent", "searchsubagent", "search_code_subagent", "explore_subagent"]);
const isSubagentTool = (name: string | undefined): boolean => name !== undefined && SUBAGENT_TOOLS.has(name.toLowerCase());

// String values of a call's arguments long enough to identify a prompt.
const MIN_INPUT_LENGTH = 20;
function longStrings(value: unknown, out: string[], depth = 0): void {
  if (depth > 6) return;
  if (typeof value === "string") {
    const parsed = value.startsWith("{") || value.startsWith("[") ? tryParse(value) : undefined;
    if (parsed !== undefined) longStrings(parsed, out, depth + 1);
    else if (value.length >= MIN_INPUT_LENGTH) out.push(value);
  } else if (Array.isArray(value)) value.forEach((v) => longStrings(v, out, depth + 1));
  else if (isObj(value)) Object.values(value).forEach((v) => longStrings(v, out, depth + 1));
}
function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// ---- classic Copilot Chat ----------------------------------------------------------

export type ChildFile = { kind: "missing" } | { kind: "not-file" } | { kind: "unreadable" } | { kind: "text"; text: string };

export interface ClassicInput {
  // The session folder's name: an orphan file belongs here only if its
  // session_start says so.
  folderId: string;
  mainText: string;
  // Every name in the session folder, and the way to read one.
  names: readonly string[];
  read: (name: string) => ChildFile;
}

export interface OracleRun {
  runId: string;
  label: string;
  counts: OutcomeCounts;
  // Placed by a time window or by file time, not by the run's own link.
  matchedByTime: boolean;
}

export type UnreadCause = "missing" | "invalid-name" | "not-file" | "unreadable" | "empty" | "no-identity" | "too-many" | "unlogged-call";

export interface OracleUnreadRun {
  // Null where the product names the run by a stand-in (the ref had no usable id).
  runId: string | null;
  cause: UnreadCause;
}

export interface ClassicResult {
  main: OutcomeCounts;
  runs: OracleRun[];
  unreadRuns: OracleUnreadRun[];
  // Run logs no turn could own (a ref before the first prompt, an orphan of
  // another session or outside every window): no run row, only session counts.
  unplaced: number;
  // Child-log call ids already counted (the parent's, or an earlier run's).
  duplicateCallIds: number;
  // Refs a child log holds (nested runs, not read).
  nestedRefs: number;
  subagentInputs: string[];
}

const SUBAGENT_LOG_NAME = /^(runSubagent-[A-Za-z0-9_-]+|searchSubagent-[A-Za-z0-9_-]+)\.jsonl$/;
const MAX_SUBAGENT_FILES = 200;
const RUN_ID = /^[A-Za-z0-9_-]{1,128}$/;
const RUN_LABEL = /^(runSubagent-[A-Za-z0-9_ -]{1,64}|searchSubagent)$/;
const CALL_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

interface Span {
  id: string | undefined;
  name: string | undefined;
  ts: number | undefined;
  dur: number;
  key: OutcomeKey;
  turn: number;
}

function statusKey(event: Obj): OutcomeKey {
  if (event.status === "ok") return "succeeded";
  if (event.status === "error") {
    const text = isObj(event.attrs) && typeof event.attrs.error === "string" ? event.attrs.error : "";
    return /^canceled$/i.test(text.trim()) ? "canceled" : "failed";
  }
  return "unknown";
}

function spansOf(events: readonly Obj[]): Span[] {
  const spans: Span[] = [];
  let turn = -1;
  for (const event of events) {
    if (event.type === "user_message") turn += 1;
    else if (event.type === "tool_call") {
      spans.push({ id: str(event.spanId), name: str(event.name), ts: finite(event.ts), dur: finite(event.dur) ?? 0, key: statusKey(event), turn });
    }
  }
  return spans;
}

interface Ref {
  turn: number | null;
  id: string | null;
  file: string | null;
  label: string | null;
  ts: number | null;
  parentSpanId: string | null;
}

function refsOf(events: readonly Obj[]): Ref[] {
  const refs: Ref[] = [];
  let turns = 0;
  for (const event of events) {
    if (event.type === "user_message") turns += 1;
    else if (event.type === "child_session_ref") {
      const a = isObj(event.attrs) ? event.attrs : {};
      refs.push({
        turn: turns === 0 ? null : turns - 1,
        id: typeof a.childSessionId === "string" ? a.childSessionId : null,
        file: typeof a.childLogFile === "string" ? a.childLogFile : null,
        label: typeof a.label === "string" ? a.label : null,
        ts: finite(event.ts) ?? null,
        parentSpanId: typeof event.parentSpanId === "string" ? event.parentSpanId : null,
      });
    }
  }
  return refs;
}

// The turn whose window [its prompt's ts, the next one's) holds `at`; null
// unless exactly one does.
function turnAt(starts: readonly (number | null)[], at: number): number | null {
  let match: number | null = null;
  for (let i = 0; i < starts.length; i++) {
    const from = starts[i]!;
    const to = i + 1 < starts.length ? starts[i + 1]! : Number.POSITIVE_INFINITY;
    if (from === null || to === null || !(from <= at && at < to)) continue;
    if (match !== null) return null;
    match = i;
  }
  return match;
}

const firstMatching = (pattern: RegExp, candidates: unknown[]): string | null => {
  for (const c of candidates) if (typeof c === "string" && pattern.test(c)) return c;
  return null;
};

interface ReadRun {
  turn: number;
  runId: string;
  label: string;
  spans: Span[];
  attribution: "ref" | "orphan";
  linkedByTime: boolean;
  startedAt: number;
}

export function classicOracle(input: ClassicInput): ClassicResult {
  const main = parseJsonlObjects(input.mainText);
  const spans = spansOf(main).filter((s) => s.turn >= 0);
  const turnStarts = main.filter((e) => e.type === "user_message").map((e) => finite(e.ts) ?? null);
  const result: ClassicResult = { main: emptyCounts(), runs: [], unreadRuns: [], unplaced: 0, duplicateCallIds: 0, nestedRefs: 0, subagentInputs: [] };
  for (const s of spans) tally(result.main, s.key);
  for (const event of main) {
    if (event.type === "tool_call" && isSubagentTool(str(event.name)) && isObj(event.attrs)) longStrings(event.attrs.args, result.subagentInputs);
  }

  const matching = input.names.filter((n) => SUBAGENT_LOG_NAME.test(n)).sort();
  const tooMany = matching.length > MAX_SUBAGENT_FILES;
  const refs = refsOf(main);
  const referenced = new Set<string>();
  const read: ReadRun[] = [];
  const claimed = new Set<string>();

  // The one subagent-kind main call, on the ref's turn, whose time window
  // holds the ref (explore_subagent writes no parentSpanId).
  const windowCall = (ref: Ref): string | undefined => {
    if (ref.ts === null || ref.turn === null) return undefined;
    const hits = spans.filter((s) => s.turn === ref.turn && isSubagentTool(s.name) && s.id !== undefined && s.ts !== undefined && s.ts <= ref.ts! && ref.ts! <= s.ts + s.dur);
    return hits.length === 1 && CALL_ID.test(hits[0]!.id!) ? hits[0]!.id : undefined;
  };

  const unread = (ref: Ref, cause: UnreadCause) => result.unreadRuns.push({ runId: ref.id !== null && RUN_ID.test(ref.id) ? ref.id : null, cause });

  for (const ref of refs) {
    if (ref.file !== null) {
      if (referenced.has(ref.file)) continue;
      referenced.add(ref.file);
    }
    if (ref.turn === null) {
      result.unplaced += 1;
      continue;
    }
    let linkedByTime = false;
    if (ref.parentSpanId !== null) {
      if (CALL_ID.test(ref.parentSpanId)) claimed.add(ref.parentSpanId);
    } else {
      const byWindow = windowCall(ref);
      if (byWindow !== undefined) {
        claimed.add(byWindow);
        linkedByTime = true;
      }
    }
    if (tooMany) {
      unread(ref, "too-many");
      continue;
    }
    if (ref.file === null || !SUBAGENT_LOG_NAME.test(ref.file)) {
      unread(ref, "invalid-name");
      continue;
    }
    const file = input.read(ref.file);
    if (file.kind !== "text") {
      unread(ref, file.kind);
      continue;
    }
    const events = parseJsonlObjects(file.text);
    if (events.length === 0) {
      unread(ref, "empty");
      continue;
    }
    const start = events.find((e) => e.type === "session_start");
    const runId = firstMatching(RUN_ID, [ref.id, start?.sid]);
    const label = firstMatching(RUN_LABEL, [ref.label, isObj(start?.attrs) ? start.attrs.label : undefined]);
    if (runId === null || label === null) {
      unread(ref, "no-identity");
      continue;
    }
    result.nestedRefs += events.filter((e) => e.type === "child_session_ref").length;
    read.push({ turn: ref.turn, runId, label, spans: spansOf(events).map((s) => ({ ...s, turn: 0 })), attribution: "ref", linkedByTime, startedAt: finite(start?.ts) ?? Number.NaN });
  }

  if (!tooMany) {
    const orphans: ReadRun[] = [];
    for (const name of matching.filter((n) => !referenced.has(n))) {
      const file = input.read(name);
      const events = file.kind === "text" ? parseJsonlObjects(file.text) : [];
      const start = events.find((e) => e.type === "session_start");
      const runId = firstMatching(RUN_ID, [start?.sid]);
      const label = firstMatching(RUN_LABEL, [isObj(start?.attrs) ? start.attrs.label : undefined]);
      const at = finite(start?.ts);
      const turn = isObj(start?.attrs) && start.attrs.parentSessionId === input.folderId && at !== undefined ? turnAt(turnStarts, at) : null;
      if (events.length === 0 || runId === null || label === null || turn === null) {
        result.unplaced += 1;
        continue;
      }
      result.nestedRefs += events.filter((e) => e.type === "child_session_ref").length;
      orphans.push({ turn, runId, label, spans: spansOf(events).map((s) => ({ ...s, turn: 0 })), attribution: "orphan", linkedByTime: true, startedAt: at! });
    }
    orphans.sort((a, b) => a.startedAt - b.startedAt);
    read.push(...orphans);
  }

  // Read order: by turn, refs before orphans within it (the sort is stable).
  const counted = new Set(spans.flatMap((s) => (s.id === undefined ? [] : [s.id])));
  for (const run of [...read].sort((a, b) => a.turn - b.turn)) {
    const counts = emptyCounts();
    for (const s of run.spans) {
      if (s.id !== undefined) {
        if (counted.has(s.id)) {
          result.duplicateCallIds += 1;
          continue;
        }
        counted.add(s.id);
      }
      tally(counts, s.key);
    }
    result.runs.push({ runId: run.runId, label: run.label, counts, matchedByTime: run.attribution === "orphan" || run.linkedByTime });
  }
  // A subagent-kind main call no run's link claimed is a run with no log.
  for (const s of spans) {
    if (!isSubagentTool(s.name) || (s.id !== undefined && claimed.has(s.id))) continue;
    result.unreadRuns.push({ runId: s.id !== undefined && RUN_ID.test(s.id) ? s.id : null, cause: "unlogged-call" });
  }
  return result;
}

// ---- Agent Host --------------------------------------------------------------------

export interface AgentHostRun {
  runId: string;
  counts: OutcomeCounts;
  // The chain from a call to the call that started its run is broken.
  flagged: boolean;
}

export interface AgentHostResult {
  main: OutcomeCounts;
  runs: AgentHostRun[];
  subagentInputs: string[];
}

interface Draft {
  id: string;
  name: string | undefined;
  args: unknown;
  agentId: string | null;
  parent: string | undefined;
  turn: number;
}

const approved = (kind: string) => kind === "approved" || kind === "approved-for-location";
const sanitizeRunId = (raw: string): string => {
  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128);
  return RUN_ID.test(cleaned) ? cleaned : "unknown";
};

export function agentHostOracle(events: readonly unknown[]): AgentHostResult {
  const drafts = new Map<string, Draft>();
  const completes = new Map<string, boolean>();
  const permissions = new Map<string, string>();
  const aborted = new Set<number>();
  let turn = -1;
  for (const raw of events) {
    if (!isObj(raw)) continue;
    const type = str(raw.type);
    const data = isObj(raw.data) ? raw.data : {};
    const agentId = str(raw.agentId) ?? null;
    if (type === "user.message" && agentId === null && !(typeof data.source === "string" && data.source.startsWith("agent-"))) turn += 1;
    if (type === "abort") aborted.add(turn);
    const id = str(data.toolCallId);
    if (type === "assistant.message") {
      for (const request of Array.isArray(data.toolRequests) ? data.toolRequests : []) {
        const requestId = isObj(request) ? str(request.toolCallId) : undefined;
        if (!requestId || drafts.has(requestId)) continue;
        drafts.set(requestId, { id: requestId, name: str((request as Obj).name), args: (request as Obj).arguments, agentId, parent: undefined, turn });
      }
    } else if (type === "tool.execution_start" && id) {
      const draft = drafts.get(id) ?? { id, name: undefined, args: undefined, agentId, parent: undefined, turn };
      drafts.set(id, draft);
      draft.name = str(data.toolName) ?? draft.name;
      draft.args = data.arguments ?? draft.args;
      draft.agentId = agentId;
      draft.parent = str(data.parentToolCallId) ?? draft.parent;
    } else if (type === "tool.execution_complete" && id) completes.set(id, data.success === true);
    else if (type === "permission.completed" && id) {
      const kind = isObj(data.result) ? str(data.result.kind) : undefined;
      if (kind === undefined) permissions.delete(id);
      else permissions.set(id, kind);
    }
  }

  const keyOf = (d: Draft): OutcomeKey => {
    const permission = permissions.get(d.id);
    if (permission !== undefined && !approved(permission)) return "denied";
    const complete = completes.get(d.id);
    if (complete !== undefined) return complete ? "succeeded" : "failed";
    return aborted.has(d.turn) ? "interrupted" : "unknown";
  };

  const result: AgentHostResult = { main: emptyCounts(), runs: [], subagentInputs: [] };
  const runs = new Map<string, AgentHostRun>();
  for (const d of drafts.values()) {
    if (isSubagentTool(d.name)) longStrings(d.args, result.subagentInputs);
    if (d.agentId === null) {
      tally(result.main, keyOf(d));
      continue;
    }
    // Walk up to the main agent's call; a missing link or a cycle breaks it.
    const seen = new Set<string>([d.id]);
    let current = d;
    let broken = false;
    while (current.agentId !== null) {
      const next = current.parent === undefined ? undefined : drafts.get(current.parent);
      if (next === undefined || seen.has(next.id)) {
        broken = true;
        break;
      }
      seen.add(next.id);
      current = next;
    }
    const runId = sanitizeRunId(d.parent ?? d.agentId);
    const run = runs.get(runId) ?? { runId, counts: emptyCounts(), flagged: false };
    runs.set(runId, run);
    tally(run.counts, keyOf(d));
    run.flagged ||= broken;
  }
  result.runs = [...runs.values()];
  return result;
}
