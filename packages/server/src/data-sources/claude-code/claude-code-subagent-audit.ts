// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { SubagentRunGap, ToolCallOrigin, ToolCallRecord } from "@agent-cost-analyzer/domain";
import { gapsByLogTurn } from "../jsonl/subagent-run-gaps.js";
import type { UnreadRun } from "../jsonl/subagent-run-plan.js";
import type { ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";
import { extractRunToolCalls } from "./subagent-audit-calls.js";
import { planClaudeCodeAudit, type AuditRunRef } from "./subagent-audit-plan.js";
import { UNREADABLE_TRANSCRIPT_AUDIT_REASON } from "./subagent-audit-reasons.js";
import type { ClaudeCodeRunInput, ClaudeCodeSubagentAttribution } from "./subagent-attribution.js";

// CS14 (docs/plans/claude-code-subagents.md D9, section 5.1 of
// subagent-tool-audit.md): one Claude Code session's subagent tool calls, in
// the same shape step 10.20 gives classic sessions. Only the detail read calls
// it; the list path and the run-summary cache never see a tool call.

/** A run's full transcript, or null when it can't be read (a failure is a gap, not a throw). */
export type LoadRunEntries = (agentId: string) => Promise<readonly ClaudeCodeRawEntry[] | null>;

export interface ClaudeCodeSubagentAuditInput {
  /** The placement the usage fold made, so the audit and the cost views link the same runs. */
  attribution: Pick<ClaudeCodeSubagentAttribution, "byTurn">;
  /** Run metas by agent id come from here (`spawnDepth`, `toolUseId`). */
  runs: readonly Pick<ClaudeCodeRunInput, "agentId" | "meta">[];
  /** The main agent's call ids: a fork's copies of them are not counted again. */
  mainCallIds: ReadonlySet<string>;
  turnCount: number;
  loadEntries: LoadRunEntries;
}

export interface ClaudeCodeSubagentAudit {
  /** Per turn, the runs' calls to append after the main agent's. */
  callsByTurn: ToolCallRecord[][];
  gapsByTurn: SubagentRunGap[][];
  /** Per turn, the runs read in full (Turn.subagentRunsRead). */
  readRunIdsByTurn: string[][];
}

export type ClaudeCodeSubagentAuditReader = (input: ClaudeCodeSubagentAuditInput) => Promise<ClaudeCodeSubagentAudit>;

const toUnread = (run: AuditRunRef, reason: string): UnreadRun => ({
  logTurn: run.turn,
  runId: run.runId,
  label: run.label,
  depth: run.depth,
  ...(run.parentRunId === undefined ? {} : { parentRunId: run.parentRunId }),
  reason,
});

const originOf = (run: AuditRunRef): ToolCallOrigin => ({
  kind: "subagent",
  runId: run.runId,
  label: run.label,
  depth: run.depth,
  ...(run.parentRunId === undefined ? {} : { parentRunId: run.parentRunId }),
  ...(run.startedByCallId === undefined ? {} : { startedByCallId: run.startedByCallId }),
});

async function loadOrNull(load: LoadRunEntries, agentId: string): Promise<readonly ClaudeCodeRawEntry[] | null> {
  try {
    const entries = await load(agentId);
    return entries === null || entries.length === 0 ? null : entries;
  } catch {
    return null;
  }
}

export const readClaudeCodeSubagentAudit: ClaudeCodeSubagentAuditReader = async ({
  attribution,
  runs,
  mainCallIds,
  turnCount,
  loadEntries,
}) => {
  const metas = new Map(runs.flatMap((run) => (run.meta === undefined ? [] : [[run.agentId, run.meta] as const])));
  const plan = planClaudeCodeAudit(attribution, metas);
  const unread: UnreadRun[] = plan.unread.map((run) => toUnread(run, run.reason));

  // Outer runs before inner ones: the first log in read order owns a call id.
  const counted = new Set(mainCallIds);
  const callsOf = new Map<string, ToolCallRecord[]>();
  for (const run of [...plan.reads].sort((a, b) => a.depth - b.depth)) {
    const entries = await loadOrNull(loadEntries, run.runId);
    if (entries === null) {
      unread.push(toUnread(run, UNREADABLE_TRANSCRIPT_AUDIT_REASON));
      continue;
    }
    callsOf.set(run.runId, extractRunToolCalls(entries, originOf(run), counted));
  }

  const size = Math.max(turnCount, ...plan.reads.map((run) => run.turn + 1), ...unread.map((run) => (run.logTurn ?? -1) + 1));
  const callsByTurn: ToolCallRecord[][] = Array.from({ length: size }, () => []);
  const readRunIdsByTurn: string[][] = Array.from({ length: size }, () => []);
  // Turn order, then start order within a turn, as the attribution gave it.
  for (const run of plan.reads) {
    const calls = callsOf.get(run.runId);
    if (calls === undefined) continue;
    callsByTurn[run.turn]!.push(...calls);
    readRunIdsByTurn[run.turn]!.push(run.runId);
  }
  return { callsByTurn, gapsByTurn: gapsByLogTurn(unread, size), readRunIdsByTurn };
};
