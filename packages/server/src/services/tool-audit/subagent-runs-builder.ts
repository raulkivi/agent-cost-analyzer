// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { AuditedRun, Session, ToolCallRecord, Turn } from "@agent-cost-analyzer/domain";
import { addToTotals, emptyTotals, failureRateOf } from "./outcome-tally.js";

interface RunDraft {
  runId: string;
  label: string;
  depth: number;
  parentRunId?: string;
  turnIndex: number;
  calls: ToolCallRecord[];
  reason?: string;
}

function defaultUnreadReason(label: string): string {
  return `The tool calls of the subagent run ${label} were not read, so they are unknown.`;
}

// One draft per run a turn started, from three sources in precedence order
// of detail: the run's calls (origin), the reader's gap (reason, nesting),
// the cost side's usage entry (every run 10.19 knows of).
function draftsOf(turn: Turn): RunDraft[] {
  const drafts = new Map<string, RunDraft>();
  const draft = (runId: string, init: Omit<RunDraft, "runId" | "turnIndex" | "calls">): RunDraft => {
    let existing = drafts.get(runId);
    if (!existing) {
      existing = { runId, turnIndex: turn.index, calls: [], ...init };
      drafts.set(runId, existing);
    }
    return existing;
  };

  for (const run of turn.usage.subagents ?? []) {
    draft(run.id, { label: run.label, depth: run.parentRunId ? 2 : 1, ...(run.parentRunId ? { parentRunId: run.parentRunId } : {}) });
  }
  for (const call of turn.toolCalls) {
    if (call.origin?.kind === "subagent") {
      const { runId, label, depth, parentRunId } = call.origin;
      const entry = draft(runId, { label, depth, ...(parentRunId ? { parentRunId } : {}) });
      entry.calls.push(call);
    }
  }
  for (const gap of turn.subagentRunGaps ?? []) {
    const entry = draft(gap.runId, {
      label: gap.label,
      depth: gap.depth,
      ...(gap.parentRunId ? { parentRunId: gap.parentRunId } : {}),
    });
    entry.reason = gap.reason;
  }
  return [...drafts.values()];
}

function rowOf(entry: RunDraft): AuditedRun {
  const { runId, label, depth, parentRunId, turnIndex } = entry;
  const head = { runId, label, depth, ...(parentRunId ? { parentRunId } : {}), turnIndex };
  if (entry.calls.length === 0) {
    // No call seen: unknown, never 0 (constraint 6).
    return { ...head, totals: null, failureRate: null, unreadReason: entry.reason ?? defaultUnreadReason(label) };
  }
  const totals = emptyTotals();
  entry.calls.forEach((call) => addToTotals(totals, call));
  return { ...head, totals, failureRate: failureRateOf(totals), ...(entry.reason ? { unreadReason: entry.reason } : {}) };
}

// Pure: one row per subagent run the session's turns know of, read or not
// (docs/plans/subagent-tool-audit.md §5.5, §6, D5, D12).
export function buildSubagentRuns(session: Session): AuditedRun[] {
  return session.turns.flatMap((turn) => draftsOf(turn).map(rowOf));
}
