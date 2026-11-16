// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ToolCallOrigin, ToolCallRecord } from "@agent-cost-analyzer/domain";
import {
  SUBAGENT_LOG_NAME_REJECTED_REASON,
  SUBAGENT_LOG_NOT_REGULAR_FILE_REASON,
  SUBAGENT_LOG_READ_FAILED_REASON,
} from "./subagent-attribution.js";
import { resolveSubagentLogPath } from "./subagent-log-path.js";
import type { PlannedRun, UnreadRun } from "./subagent-run-plan.js";
import { BEYOND_READ_DEPTH_REASON, missingSubagentLogReason } from "./subagent-tool-call-reasons.js";
import { readToolCallRecords } from "./tool-call-spans.js";

// Step 10.20 (plan §5.2, §5.4, §6): the tool calls of the subagent runs a
// classic session started, read from the child file 10.19 found. The usage
// path keeps its own attrs allow-list; this second stream uses the audit
// projector (no result text). Only the detail read calls it.

export interface SubagentToolCalls {
  // Per log turn: the runs' calls, each run in the order given, each run's
  // calls in file order (D2). The caller appends them after the main agent's.
  byTurn: Map<number, ToolCallRecord[]>;
  unread: UnreadRun[];
  // Runs whose log was read in full, with or without calls: a read run with no
  // call is a known 0, which only this list tells apart from an unknown.
  read: { logTurn: number; runId: string }[];
}

const MAX_RUN_DEPTH = 8;

interface Entry {
  logTurn: number;
  run: PlannedRun;
  depth: number;
}

// The depth the run's parent chain gives; unknown parents stop the walk (the
// run's own depth stands), a cycle never ends.
function chainDepth(run: PlannedRun, byId: ReadonlyMap<string, PlannedRun>): number {
  const seen = new Set<string>([run.runId]);
  let depth = 1;
  let parent = run.parentRunId === undefined ? undefined : byId.get(run.parentRunId);
  while (parent !== undefined) {
    if (seen.has(parent.runId)) {
      return Number.POSITIVE_INFINITY;
    }
    seen.add(parent.runId);
    depth += 1;
    parent = parent.parentRunId === undefined ? undefined : byId.get(parent.parentRunId);
  }
  return Math.max(depth, run.depth);
}

function entriesOf(runsByTurn: ReadonlyMap<number, readonly PlannedRun[]>): Entry[] {
  const all = [...runsByTurn.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([logTurn, runs]) => runs.map((run) => ({ logTurn, run })));
  const byId = new Map(all.map(({ run }) => [run.runId, run]));
  return all.map((entry) => ({ ...entry, depth: chainDepth(entry.run, byId) }));
}

function unreadOf({ logTurn, run }: Entry, reason: string): UnreadRun {
  return {
    logTurn,
    runId: run.runId,
    label: run.label,
    depth: run.depth,
    ...(run.parentRunId === undefined ? {} : { parentRunId: run.parentRunId }),
    reason,
  };
}

function originOf({ run, depth }: Entry): ToolCallOrigin {
  return {
    kind: "subagent",
    runId: run.runId,
    label: run.label,
    depth,
    ...(depth > 1 && run.parentRunId !== undefined ? { parentRunId: run.parentRunId } : {}),
    ...(run.startedByCallId === undefined ? {} : { startedByCallId: run.startedByCallId }),
  };
}

type RunRead = { status: "read"; calls: ToolCallRecord[] } | { status: "unread"; reason: string };

async function readRun(entry: Entry, sessionDir: string): Promise<RunRead> {
  const { run } = entry;
  if (run.log.status === "unread") {
    return { status: "unread", reason: run.log.reason };
  }
  if (entry.depth > MAX_RUN_DEPTH) {
    return { status: "unread", reason: BEYOND_READ_DEPTH_REASON };
  }

  // The same path rules as the usage read: bare names, same folder, lstat.
  const resolution = resolveSubagentLogPath(sessionDir, run.log.childLogFile);
  if (resolution.status === "invalid-name") {
    return { status: "unread", reason: SUBAGENT_LOG_NAME_REJECTED_REASON };
  }
  if (resolution.status === "missing") {
    return { status: "unread", reason: missingSubagentLogReason(run.label) };
  }
  if (resolution.status === "not-a-regular-file") {
    return { status: "unread", reason: SUBAGENT_LOG_NOT_REGULAR_FILE_REASON };
  }
  try {
    const origin = originOf(entry);
    return { status: "read", calls: (await readToolCallRecords(resolution.path)).map((call) => ({ ...call, origin })) };
  } catch {
    return { status: "unread", reason: SUBAGENT_LOG_READ_FAILED_REASON };
  }
}

// §5.4: a call id counts once per session. The first log in read order wins:
// the parent's (`parentCallIds`), then outer runs before inner ones, then the
// order given. Calls with no id are never merged.
function dedupeOrder(entries: readonly Entry[]): Entry[] {
  return [...entries].sort((a, b) => a.depth - b.depth);
}

export async function readSubagentToolCalls(
  runsByTurn: ReadonlyMap<number, readonly PlannedRun[]>,
  sessionDir: string,
  parentCallIds: ReadonlySet<string> = new Set(),
): Promise<SubagentToolCalls> {
  const entries = entriesOf(runsByTurn);
  const reads = new Map<Entry, RunRead>();
  for (const entry of entries) {
    reads.set(entry, await readRun(entry, sessionDir));
  }

  const counted = new Set(parentCallIds);
  const kept = new Map<Entry, ToolCallRecord[]>();
  for (const entry of dedupeOrder(entries)) {
    const read = reads.get(entry);
    if (read?.status !== "read") {
      continue;
    }
    kept.set(
      entry,
      read.calls.filter((call) => {
        if (call.id === undefined) {
          return true;
        }
        if (counted.has(call.id)) {
          return false;
        }
        counted.add(call.id);
        return true;
      }),
    );
  }

  const byTurn = new Map<number, ToolCallRecord[]>();
  const unread: UnreadRun[] = [];
  const readRuns: SubagentToolCalls["read"] = [];
  for (const entry of entries) {
    const read = reads.get(entry);
    if (read?.status === "unread") {
      unread.push(unreadOf(entry, read.reason));
    } else if (read?.status === "read") {
      readRuns.push({ logTurn: entry.logTurn, runId: entry.run.runId });
      const calls = kept.get(entry) ?? [];
      if (calls.length > 0) {
        byTurn.set(entry.logTurn, [...(byTurn.get(entry.logTurn) ?? []), ...calls]);
      }
    }
  }
  return { byTurn, unread, read: readRuns };
}
