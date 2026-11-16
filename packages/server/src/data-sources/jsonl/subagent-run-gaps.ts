// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { SubagentRunGap } from "@agent-cost-analyzer/domain";
import type { UnreadRun } from "./subagent-run-plan.js";

const MAX_REASON_LENGTH = 500;
const MAX_DEPTH = 8;

// Per log turn, the gaps its unread runs leave (Turn.subagentRunGaps; the audit
// builder turns each into AuditedRun.unreadReason). A run no turn owns has no
// gap: its reason stays in the session's cost reasons.
export function gapsByLogTurn(unread: readonly UnreadRun[], logTurnCount: number): SubagentRunGap[][] {
  const gaps: SubagentRunGap[][] = Array.from({ length: logTurnCount }, () => []);
  for (const run of unread) {
    const { logTurn, runId, label } = run;
    if (logTurn === null || runId === undefined || label === undefined || gaps[logTurn] === undefined) {
      continue;
    }
    if (gaps[logTurn].some((gap) => gap.runId === runId)) {
      continue;
    }
    gaps[logTurn].push({
      runId,
      label,
      depth: Math.min(Math.max(run.depth, 1), MAX_DEPTH),
      ...(run.parentRunId === undefined ? {} : { parentRunId: run.parentRunId }),
      reason: run.reason.slice(0, MAX_REASON_LENGTH),
    });
  }
  return gaps;
}
