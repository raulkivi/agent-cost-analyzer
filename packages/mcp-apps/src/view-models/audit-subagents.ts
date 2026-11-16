// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { AuditedRun, OriginTotals, OutcomeTotals, SessionAudit } from "@agent-cost-analyzer/domain";
import { formatCount, pluralize, UNKNOWN_TEXT } from "./format.js";

// Step 10.20, ST13 (docs/plans/subagent-tool-audit.md §5.7, §6, D12, D14):
// the subagent half of U4. Pure. Run labels and reasons are logged text:
// display only, never sent to the host's model (§6).

export type AgentScope = "all" | "main" | "subagents";

export interface ScopeOption {
  value: AgentScope;
  label: string;
  selected: boolean;
}

export interface AuditRunRow {
  key: string;
  kind: "known" | "unread" | "flagged"; // flagged: known totals plus a reason (D12)
  label: string;
  depthText?: string;
  turnText: string;
  callsText: string;
  failedText: string;
  unknownText: string;
  rateText: string;
  figuresText: string; // "41 calls · 4 failed · 1 unknown · 10.0 %"; "calls unknown" for an unread run
  reason?: string; // logged text
}

export interface AgentSplitPart {
  label: string;
  callsText: string;
  shareText: string;
  fraction: number;
}

export interface SubagentsSection {
  scopes: ScopeOption[];
  split: { main: AgentSplitPart; subagents: AgentSplitPart };
  runs: AuditRunRow[];
  unreadNote?: string;
}

const SCOPES: readonly { value: AgentScope; label: string }[] = [
  { value: "all", label: "All" },
  { value: "main", label: "Main agent" },
  { value: "subagents", label: "Subagents" },
];

export const SCOPE_NOTE = "Failure categories, recovery cost, retries and tools count all agents.";

const failedOf = (totals: Pick<OutcomeTotals, "failed" | "interrupted" | "denied">): number => totals.failed + totals.interrupted + totals.denied;

// Calls with a known outcome: canceled and unknown calls are neither (D14).
export const knownCallsOf = (totals: OutcomeTotals): number => totals.succeeded + failedOf(totals);

export const rateText = (rate: number | null): string => (rate === null ? UNKNOWN_TEXT : `${(rate * 100).toFixed(1)} %`);

// The number of runs the audit lists, and how many of them were read.
export function runCounts(audit: Pick<SessionAudit, "byOrigin" | "subagentRuns">): { total: number; read: number } {
  const runs = audit.subagentRuns;
  if (runs !== undefined && runs.length > 0) return { total: runs.length, read: runs.filter((run) => run.totals !== null).length };
  const total = audit.byOrigin?.subagents.runs ?? 0;
  return { total, read: total };
}

// "incl. 83 calls from 3 of 5 subagent runs"; never a 0 for runs that were not read.
export function sublineOf(subagentCalls: number, total: number, read: number): string | undefined {
  if (total === 0) return undefined;
  if (read === 0) return `no subagent run was read (${pluralize(total, "run")})`;
  const runs = read === total ? pluralize(read, "subagent run") : `${formatCount(read)} of ${formatCount(total)} subagent runs`;
  return `incl. ${pluralize(subagentCalls, "call")} from ${runs}`;
}

export function scopeOptions(scope: AgentScope): ScopeOption[] {
  return SCOPES.map((option) => ({ ...option, selected: option.value === scope }));
}

export function unreadNoteOf(unread: number): string | undefined {
  if (unread === 0) return undefined;
  return unread === 1 ? "1 subagent run not read; its calls aren't counted." : `${formatCount(unread)} subagent runs not read; their calls aren't counted.`;
}

function runRow(run: AuditedRun, labels: ReadonlyMap<string, string>): AuditRunRow {
  const parent = run.parentRunId === undefined ? undefined : labels.get(run.parentRunId);
  const depthText = run.depth > 1 ? `depth ${run.depth}${parent === undefined ? "" : ` · in ${parent}`}` : undefined;
  const base = { key: run.runId, label: run.label, turnText: `turn ${run.turnIndex}`, ...(depthText === undefined ? {} : { depthText }) };
  if (run.totals === null) {
    return { ...base, kind: "unread", callsText: UNKNOWN_TEXT, failedText: UNKNOWN_TEXT, unknownText: UNKNOWN_TEXT, rateText: UNKNOWN_TEXT, figuresText: "calls unknown", ...(run.unreadReason === undefined ? {} : { reason: run.unreadReason }) };
  }
  return {
    ...base,
    kind: run.unreadReason === undefined ? "known" : "flagged",
    callsText: formatCount(run.totals.toolCalls),
    failedText: formatCount(failedOf(run.totals)),
    unknownText: formatCount(run.totals.unknown),
    rateText: rateText(run.failureRate),
    figuresText: [pluralize(run.totals.toolCalls, "call"), `${formatCount(failedOf(run.totals))} failed`, `${formatCount(run.totals.unknown)} unknown`, rateText(run.failureRate)].join(" · "),
    ...(run.unreadReason === undefined ? {} : { reason: run.unreadReason }),
  };
}

function part(label: string, calls: number, total: number): AgentSplitPart {
  const fraction = total > 0 ? calls / total : 0;
  return { label, callsText: formatCount(calls), shareText: `${(fraction * 100).toFixed(1)} %`, fraction };
}

export function subagentsSection(audit: SessionAudit, origin: OriginTotals, scope: AgentScope): SubagentsSection {
  const runs = audit.subagentRuns ?? [];
  const labels = new Map(runs.map((run) => [run.runId, run.label]));
  const total = origin.main.toolCalls + origin.subagents.toolCalls;
  const unreadNote = unreadNoteOf(runs.filter((run) => run.totals === null).length);
  return {
    scopes: scopeOptions(scope),
    split: { main: part("Main agent", origin.main.toolCalls, total), subagents: part("Subagent runs", origin.subagents.toolCalls, total) },
    runs: runs.map((run) => runRow(run, labels)),
    ...(unreadNote === undefined ? {} : { unreadNote }),
  };
}

export function canceledTextOf(totals: OutcomeTotals): string | undefined {
  const canceled = totals.canceled ?? 0;
  return canceled > 0 ? `${pluralize(canceled, "call")} canceled by the user: not counted as failures or unknown.` : undefined;
}
