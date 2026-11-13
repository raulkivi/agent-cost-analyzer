// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { sumTokenCounts, type TokenCount } from "@agent-cost-analyzer/domain";

export interface UsageSentenceInput {
  uncachedInput: TokenCount;
  cacheWrite: TokenCount;
  cacheRead: TokenCount;
  output: TokenCount;
  model: string;
  // Step 10.19: the classic Copilot subagent runs folded into the figures.
  subagents?: readonly { costAiCredits: TokenCount }[];
}

// Callers gate on uncachedInput/output being known; the fallback to 0 only
// serves the session enricher, which explains turns with no usage at all.
function valueOf(tokenCount: TokenCount): number {
  return tokenCount.known ? tokenCount.value : 0;
}

function tokens(count: number, qualifier: string): string {
  return `${count.toLocaleString()} ${qualifier} ${count === 1 ? "token" : "tokens"}`;
}

// Cache writes are new input too, so they are named rather than hidden in
// "new input". Unknown or zero parts are omitted, never shown as 0.
function cacheClauses(usage: UsageSentenceInput): string[] {
  const clauses: string[] = [];
  if (usage.cacheWrite.known && usage.cacheWrite.value > 0) {
    clauses.push(`wrote ${usage.cacheWrite.value.toLocaleString()} to cache`);
  }
  if (usage.cacheRead.known && usage.cacheRead.value > 0) {
    clauses.push(`reused ${usage.cacheRead.value.toLocaleString()} from cache`);
  }
  return clauses;
}

function joinClauses(clauses: string[]): string {
  if (clauses.length === 0) return "";
  if (clauses.length === 1) return ` and ${clauses[0]}`;
  return `, ${clauses[0]} and ${clauses[1]}`;
}

// "incl. 42.06 AI Credits from 1 subagent run": the share of the figures that
// the runs account for. An unknown run makes the share unknown, so no figure
// is shown (constraint 6).
function subagentClause(runs: UsageSentenceInput["subagents"]): string {
  if (runs === undefined || runs.length === 0) return "";
  const noun = runs.length === 1 ? "subagent run" : "subagent runs";
  const total = sumTokenCounts(
    runs.map((run) => run.costAiCredits),
    "",
  );
  if (!total.known) return `, incl. ${runs.length} ${noun} (their AI Credits are unknown)`;
  const credits = total.value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return `, incl. ${credits} AI Credits from ${runs.length} ${noun}`;
}

export function describeTurnUsage(usage: UsageSentenceInput): string {
  return (
    `This turn sent ${tokens(valueOf(usage.uncachedInput), "new input")}` +
    `${joinClauses(cacheClauses(usage))}, producing ${tokens(valueOf(usage.output), "output")} using ${usage.model}` +
    `${subagentClause(usage.subagents)}.`
  );
}

export function describeExchangeUsage(usage: UsageSentenceInput): string {
  return (
    `This exchange sent ${tokens(valueOf(usage.uncachedInput), "input")} and ` +
    `produced ${tokens(valueOf(usage.output), "output")} using ${usage.model}.`
  );
}
