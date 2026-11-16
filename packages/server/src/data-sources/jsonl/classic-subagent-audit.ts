// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { SubagentRunGap, ToolCallRecord } from "@agent-cost-analyzer/domain";
import type { SubagentAttribution } from "./subagent-attribution.js";
import { gapsByLogTurn } from "./subagent-run-gaps.js";
import { planSubagentRuns, type UnreadRun } from "./subagent-run-plan.js";
import { readSubagentToolCalls } from "./subagent-tool-calls.js";

export interface ClassicSubagentAuditInput {
  attribution: Pick<SubagentAttribution, "runs" | "unplaced">;
  // The main agent's own spans per log turn: they hold the calls that started
  // runs and the ids a child log must not count again.
  mainCallsByLogTurn: readonly (readonly ToolCallRecord[])[];
  sessionDir: string;
}

export interface ClassicSubagentAudit {
  // Per log turn, the runs' calls to append after the main agent's.
  callsByLogTurn: ToolCallRecord[][];
  gapsByLogTurn: SubagentRunGap[][];
  // Every run whose calls are unknown, turn or not; a run no turn owns shows
  // only here.
  unread: UnreadRun[];
}

// Step 10.20 (plan §5.2): one classic session's subagent tool calls. Only the
// detail read calls it; the list path never opens a child file for the audit.
export async function readClassicSubagentAudit({
  attribution,
  mainCallsByLogTurn,
  sessionDir,
}: ClassicSubagentAuditInput): Promise<ClassicSubagentAudit> {
  const plan = planSubagentRuns(attribution, mainCallsByLogTurn);
  const parentCallIds = new Set(mainCallsByLogTurn.flatMap((calls) => calls.flatMap((call) => (call.id === undefined ? [] : [call.id]))));
  const read = await readSubagentToolCalls(plan.runsByTurn, sessionDir, parentCallIds);

  const unread = [...read.unread, ...plan.unread];
  const logTurnCount = Math.max(
    mainCallsByLogTurn.length,
    ...[...read.byTurn.keys()].map((turn) => turn + 1),
    ...unread.flatMap((run) => (run.logTurn === null ? [] : [run.logTurn + 1])),
  );
  return {
    callsByLogTurn: Array.from({ length: logTurnCount }, (_, turn) => read.byTurn.get(turn) ?? []),
    gapsByLogTurn: gapsByLogTurn(unread, logTurnCount),
    unread,
  };
}
