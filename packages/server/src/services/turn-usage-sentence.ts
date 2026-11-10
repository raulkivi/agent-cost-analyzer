// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { TokenCount } from "@agent-cost-analyzer/domain";

export interface UsageSentenceInput {
  uncachedInput: TokenCount;
  cacheWrite: TokenCount;
  cacheRead: TokenCount;
  output: TokenCount;
  model: string;
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

export function describeTurnUsage(usage: UsageSentenceInput): string {
  return (
    `This turn sent ${tokens(valueOf(usage.uncachedInput), "new input")}` +
    `${joinClauses(cacheClauses(usage))}, producing ${tokens(valueOf(usage.output), "output")} using ${usage.model}.`
  );
}

export function describeExchangeUsage(usage: UsageSentenceInput): string {
  return (
    `This exchange sent ${tokens(valueOf(usage.uncachedInput), "input")} and ` +
    `produced ${tokens(valueOf(usage.output), "output")} using ${usage.model}.`
  );
}
