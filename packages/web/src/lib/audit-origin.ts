// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { AuditedRun, OutcomeTotals, ToolCallOrigin } from "@agent-cost-analyzer/domain";

// Step 10.20 (docs/plans/subagent-tool-audit.md §5.7). Labels and ids are
// log text: callers render these strings as React text only.

export type AgentFilter = "all" | "main" | "subagent";

export const AGENT_FILTER_LABELS: Record<AgentFilter, string> = { all: "All", main: "Main agent", subagent: "Subagents" };

export const isSubagentCall = (origin: ToolCallOrigin | undefined): boolean => origin?.kind === "subagent";

export function matchesAgentFilter(origin: ToolCallOrigin | undefined, filter: AgentFilter): boolean {
  return filter === "all" || (filter === "subagent") === isSubagentCall(origin);
}

// "depth 2" only where the run is nested; a first-level run needs no number.
export function depthText(depth: number): string | undefined {
  return depth > 1 ? `depth ${depth}` : undefined;
}

export const callsWord = (count: number): string => `${count} ${count === 1 ? "call" : "calls"}`;
export const runsWord = (count: number): string => `${count} subagent ${count === 1 ? "run" : "runs"}`;

// A run is unread when its totals are null; a reason beside known totals is a
// flag (D12). Unknown is never shown as 0.
export const isUnreadRun = (run: Pick<AuditedRun, "totals">): boolean => run.totals === null;

// The KPI sub-line: "incl. 5 calls from 3 subagent runs", or "... from 2 of 3
// subagent runs" when some runs were not read (their calls are not counted).
export function subagentSubLine(subagentCalls: number, runs: readonly Pick<AuditedRun, "totals">[]): string {
  const read = runs.filter((run) => !isUnreadRun(run)).length;
  return read === runs.length
    ? `incl. ${callsWord(subagentCalls)} from ${runsWord(runs.length)}`
    : `incl. ${callsWord(subagentCalls)} from ${read} of ${runsWord(runs.length)}`;
}

export function canceledOf(totals: OutcomeTotals): number {
  return totals.canceled ?? 0;
}
