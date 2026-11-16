// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { subagentRunIdSchema, type ToolCallRecord } from "@agent-cost-analyzer/domain";
import { runIdentityOf, type AttributedRun, type UnplacedRunFile } from "./attributed-run-ledger.js";
import {
  SUBAGENT_LOG_MISSING_REASON,
  SUBAGENT_LOGS_TOO_MANY_REASON,
  type SubagentAttribution,
} from "./subagent-attribution.js";
import {
  missingSubagentLogReason,
  NESTED_SUBAGENT_NOT_READ_REASON,
  TOO_MANY_SUBAGENT_LOGS_REASON,
  UNLOGGED_SUBAGENT_TOOL_REASON,
} from "./subagent-tool-call-reasons.js";

// Step 10.20 (plan §5.2, §6): which runs the audit reads, which it can't, and
// the call each started. Pure: no file is touched here.

const CALL_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

// A run the audit reads (or knows it can't), on one log turn.
export interface PlannedRun {
  runId: string;
  label: string;
  // 1 = started by the main agent.
  depth: number;
  parentRunId?: string;
  startedByCallId?: string;
  log: { status: "read"; childLogFile: string } | { status: "unread"; reason: string };
}

// A run whose calls are unknown. `logTurn` null: no turn owns it, so only the
// session's counts can show it; then it has no identity either.
export interface UnreadRun {
  logTurn: number | null;
  runId?: string;
  label?: string;
  depth: number;
  parentRunId?: string;
  reason: string;
}

export interface SubagentRunPlan {
  runsByTurn: Map<number, PlannedRun[]>;
  unread: UnreadRun[];
}

type MainCalls = readonly (readonly ToolCallRecord[])[];

function windowOf(call: ToolCallRecord): { from: number; to: number } | null {
  const from = call.startedAt === undefined ? Number.NaN : Date.parse(call.startedAt);
  return Number.isFinite(from) ? { from, to: from + (call.durationMs ?? 0) } : null;
}

// The call that started a run: the ref's own span when it names one; else the
// one subagent-kind call, on the same turn, whose time window holds the ref
// (explore_subagent, plan §14.1). Two candidates name no call rather than a
// guess.
function startedByCallOf(run: AttributedRun, mainCalls: MainCalls): string | undefined {
  if (run.parentSpanId !== null) {
    return CALL_ID.test(run.parentSpanId) ? run.parentSpanId : undefined;
  }
  if (run.refTs === null) {
    return undefined;
  }
  const candidates = (mainCalls[run.logTurn] ?? []).filter((call) => {
    const window = windowOf(call);
    return call.kind === "subagent" && call.id !== undefined && window !== null && window.from <= run.refTs! && run.refTs! <= window.to;
  });
  const only = candidates.length === 1 ? candidates[0].id : undefined;
  return only !== undefined && CALL_ID.test(only) ? only : undefined;
}

// 10.19's reasons talk about AI Credits; for the two causes the audit words
// itself (§6) the sentence is about tool calls.
function logOf(run: AttributedRun): PlannedRun["log"] {
  if (run.log.status === "read") {
    return { status: "read", childLogFile: run.log.childLogFile };
  }
  const { reason } = run.log;
  if (reason === SUBAGENT_LOG_MISSING_REASON) {
    return { status: "unread", reason: missingSubagentLogReason(run.label) };
  }
  if (reason === SUBAGENT_LOGS_TOO_MANY_REASON) {
    return { status: "unread", reason: TOO_MANY_SUBAGENT_LOGS_REASON };
  }
  return { status: "unread", reason };
}

function labelOfCallName(name: string): string {
  switch (name.toLowerCase()) {
    case "runsubagent":
      return "runSubagent-unknown";
    case "search_code_subagent":
      return "search_code_subagent";
    default:
      // explore_subagent's runs are searchSubagent logs (§14.1).
      return "searchSubagent";
  }
}

function unloggedCalls(mainCalls: MainCalls, claimed: ReadonlySet<string>): UnreadRun[] {
  const unread: UnreadRun[] = [];
  mainCalls.forEach((calls, logTurn) => {
    calls.forEach((call) => {
      if (call.kind !== "subagent" || (call.id !== undefined && claimed.has(call.id))) {
        return;
      }
      // A call id outside the run id pattern (a dot, a colon) gets a stand-in.
      const id = subagentRunIdSchema.safeParse(call.id);
      unread.push({
        logTurn,
        runId: id.success ? id.data : `unlogged-call-${unread.length + 1}`,
        label: labelOfCallName(call.name),
        depth: 1,
        reason: UNLOGGED_SUBAGENT_TOOL_REASON,
      });
    });
  });
  return unread;
}

function nestedRuns(run: AttributedRun): UnreadRun[] {
  if (run.log.status !== "read") {
    return [];
  }
  return run.log.nestedRefs.map((ref, index) => ({
    logTurn: run.logTurn,
    ...runIdentityOf(ref, index + 1),
    depth: 2,
    parentRunId: run.runId,
    reason: NESTED_SUBAGENT_NOT_READ_REASON,
  }));
}

function nestedFiles(runs: readonly AttributedRun[]): Set<string> {
  return new Set(
    runs.flatMap((run) => (run.log.status === "read" ? run.log.nestedRefs : []).flatMap((ref) => (ref.childLogFile === null ? [] : [ref.childLogFile]))),
  );
}

function unplacedRuns(unplaced: readonly UnplacedRunFile[], nested: ReadonlySet<string>): UnreadRun[] {
  return unplaced
    .filter((file) => file.childLogFile === null || !nested.has(file.childLogFile))
    .map((file) => ({ logTurn: null, depth: 1, reason: file.reason }));
}

export function planSubagentRuns(
  { runs, unplaced }: Pick<SubagentAttribution, "runs" | "unplaced">,
  mainCalls: MainCalls,
): SubagentRunPlan {
  const runsByTurn = new Map<number, PlannedRun[]>();
  const claimed = new Set<string>();
  for (const run of runs) {
    const startedByCallId = startedByCallOf(run, mainCalls);
    if (startedByCallId !== undefined) {
      claimed.add(startedByCallId);
    }
    const planned: PlannedRun = {
      runId: run.runId,
      label: run.label,
      depth: 1,
      ...(startedByCallId === undefined ? {} : { startedByCallId }),
      log: logOf(run),
    };
    runsByTurn.set(run.logTurn, [...(runsByTurn.get(run.logTurn) ?? []), planned]);
  }

  return {
    runsByTurn,
    unread: [...runs.flatMap(nestedRuns), ...unloggedCalls(mainCalls, claimed), ...unplacedRuns(unplaced, nestedFiles(runs))],
  };
}
