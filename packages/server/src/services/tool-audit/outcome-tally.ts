// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import {
  isFailedStatus,
  type FailureCategory,
  type OutcomeTotals,
  type ToolCallRecord,
  type ToolCallStatus,
} from "@agent-cost-analyzer/domain";

// Shared counting primitives for the session and rollup builders.

export const NO_OUTCOME_REASON = "This session's log provider does not record tool-call outcomes.";

export function statusOf(call: ToolCallRecord): ToolCallStatus {
  return call.outcome?.status ?? "unknown";
}

export function isFailedCall(call: ToolCallRecord): boolean {
  return isFailedStatus(statusOf(call));
}

export function emptyTotals(): OutcomeTotals {
  return { toolCalls: 0, succeeded: 0, failed: 0, interrupted: 0, denied: 0, unknown: 0, canceled: 0 };
}

const TOTALS_KEY: Record<ToolCallStatus, keyof OutcomeTotals> = {
  success: "succeeded",
  error: "failed",
  interrupted: "interrupted",
  denied: "denied",
  unknown: "unknown",
  canceled: "canceled",
};

export function addToTotals(totals: OutcomeTotals, call: ToolCallRecord): void {
  totals.toolCalls += 1;
  const key = TOTALS_KEY[statusOf(call)];
  totals[key] = (totals[key] ?? 0) + 1;
}

// Who issued a call, as a grouping key: "main" or one subagent run. The run
// key is prefixed so a run whose id happens to be "main" can't merge with the
// main agent (run ids allow any [A-Za-z0-9_-]{1,128}).
export const MAIN_ORIGIN_KEY = "main";

export function originKeyOf(call: ToolCallRecord): string {
  return call.origin?.kind === "subagent" ? `run:${call.origin.runId}` : MAIN_ORIGIN_KEY;
}

export function isSubagentCall(call: ToolCallRecord): boolean {
  return call.origin?.kind === "subagent";
}

// The totals split by who issued the calls. Pure counting: main plus
// subagents always equals the all-calls totals (a property test).
export function tallyByOrigin(calls: ToolCallRecord[]): { main: OutcomeTotals; subagents: OutcomeTotals } {
  const split = { main: emptyTotals(), subagents: emptyTotals() };
  for (const call of calls) {
    addToTotals(isSubagentCall(call) ? split.subagents : split.main, call);
  }
  return split;
}

export function mergeTotals(target: OutcomeTotals, source: OutcomeTotals): void {
  for (const key of Object.keys(target) as (keyof OutcomeTotals)[]) {
    target[key] = (target[key] ?? 0) + (source[key] ?? 0);
  }
}

// (failed + interrupted + denied) over calls with a known outcome, canceled
// ones left out (D14: a user stop is not a tool result); null when none is
// known so no caller can show a fabricated 0%.
export function failureRateOf(totals: OutcomeTotals): number | null {
  const known = totals.toolCalls - totals.unknown - (totals.canceled ?? 0);
  return known === 0 ? null : (totals.failed + totals.interrupted + totals.denied) / known;
}

export function unknownReasonOf(call: ToolCallRecord): string {
  return call.outcome?.status === "unknown" ? (call.outcome.reason ?? NO_OUTCOME_REASON) : NO_OUTCOME_REASON;
}

export function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

// Counts keyed by name, returned most-frequent first (ties by name) so the
// UI and MCP clients get a stable, ranked list.
export class RankedCounter<K extends string> {
  private readonly rows = new Map<K, { calls: number; failed: number; durationMs?: number }>();

  add(key: K, calls: number, failed: number, durationMs?: number): void {
    const row = this.rows.get(key) ?? { calls: 0, failed: 0 };
    row.calls += calls;
    row.failed += failed;
    if (durationMs !== undefined) {
      row.durationMs = (row.durationMs ?? 0) + durationMs;
    }
    this.rows.set(key, row);
  }

  ranked(): { key: K; calls: number; failed: number; durationMs?: number }[] {
    return [...this.rows.entries()]
      .map(([key, row]) => ({ key, ...row }))
      .sort((a, b) => b.calls - a.calls || b.failed - a.failed || a.key.localeCompare(b.key));
  }
}

export function rankCategories(counts: Map<FailureCategory, number>): { category: FailureCategory; count: number }[] {
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}
