// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { SavingsAmount, SavingsOpportunity, SavingsReport } from "@agent-cost-analyzer/domain";

// Invented figures shaped like the SR11 boards (docs/plans/mockups/savings-report).
export const SAVINGS_FIXTURE_NOW = new Date("2026-11-13T12:00:00.000Z");

const coverage = (analysed: number, total: number, reason?: string) => ({
  sessionsInWindow: total,
  sessionsAnalysed: analysed,
  notAnalysed: reason && total > analysed ? [{ reason, sessions: total - analysed }] : [],
});

export function range(low: number, high: number, currency: "AI_CREDITS" | "USD" = "AI_CREDITS", version = "github-copilot@2026-10-01"): SavingsAmount {
  return { known: true, currency, low, high, basis: "priced", label: "range", priceVersionIds: [version] };
}

export function upTo(high: number, currency: "AI_CREDITS" | "USD" = "AI_CREDITS", version = "github-copilot@2026-10-01"): SavingsAmount {
  return { known: true, currency, low: 0, high, basis: "priced", label: "upper-bound", priceVersionIds: [version] };
}

export const UNPRICED: SavingsAmount = { known: false, reason: "no price for gpt-5.1-codex on 2026-10-22" };

export function opportunity(overrides: Partial<SavingsOpportunity> & Pick<SavingsOpportunity, "key" | "kind" | "subject">): SavingsOpportunity {
  return {
    sessions: [{ providerId: "vscode", sessionId: "session-1" }],
    evidence: { sessions: 31, requests: 877, tokens: { known: true, value: 5400 }, occurrences: 7 },
    perWeek: upTo(46),
    perWindow: upTo(197.8),
    coverage: coverage(38, 41, "no request trace"),
    actionParams: {},
    inferred: false,
    ...overrides,
  };
}

export const IDLE_CACHE = opportunity({
  key: "idle:sonnet",
  kind: "idle-cache-expiry",
  subject: "claude-sonnet-5.5",
  perWeek: upTo(46),
  perWindow: upTo(197.8),
  actionParams: { breaks: 4, minutes: 5, tokens: 80000 },
});

export const UNUSED_TOOLS = opportunity({
  key: "unused:github",
  kind: "unused-tools",
  subject: "github",
  inferred: true,
  evidence: { sessions: 31, requests: 877, tokens: { known: true, value: 5400, estimated: true }, occurrences: null },
  sessions: Array.from({ length: 8 }, (_, index) => ({ providerId: "vscode", sessionId: `session-${index + 1}` })),
  perWeek: range(6.2, 38.4),
  perWindow: range(26.7, 165.1),
  coverage: coverage(31, 41, "no tool inventory"),
  actionParams: { group: "github", tools: 23, tokens: 5400, sessions: 31, days: 30 },
});

export const FAILED_CALLS = opportunity({
  key: "failed:rg",
  kind: "failed-tool-calls",
  subject: "rg",
  evidence: { sessions: 6, requests: null, tokens: { known: false, reason: "no token count in the log" }, occurrences: 14 },
  perWeek: upTo(9.8),
  perWindow: upTo(42.1),
  coverage: coverage(40, 41, "no tool-call audit"),
  actionParams: { name: "rg", calls: 14, sessions: 6, category: "command-not-found" },
});

export const UNPRICED_ROW = opportunity({
  key: "failed:git",
  kind: "failed-tool-calls",
  subject: "git",
  perWeek: UNPRICED,
  perWindow: UNPRICED,
  coverage: coverage(40, 41, "no tool-call audit"),
  actionParams: { name: "git", calls: 3, sessions: 2, category: "git-state" },
});

export const CLAUDE_IDLE = opportunity({
  key: "idle:opus",
  kind: "idle-cache-expiry",
  subject: "claude-opus-5.5",
  sessions: [{ providerId: "claude-code", sessionId: "cc-1" }],
  perWeek: upTo(3.2, "USD", "anthropic-api@2026-09-15"),
  perWindow: upTo(13.8, "USD", "anthropic-api@2026-09-15"),
  coverage: coverage(9, 14, "no request trace"),
  actionParams: { breaks: 7, minutes: 5, tokens: 268000, extendedMinutes: 60 },
});

export const SIMULATED = opportunity({
  key: "cheaper:haiku",
  kind: "cheaper-model",
  subject: "claude-haiku-5.5",
  evidence: { sessions: 5, requests: 64, tokens: null, occurrences: null },
  perWeek: { known: true, currency: "AI_CREDITS", low: 3.1, high: 3.6, basis: "simulated", label: "simulated", priceVersionIds: ["github-copilot@2026-10-01"] },
  perWindow: { known: true, currency: "AI_CREDITS", low: 13.3, high: 15.5, basis: "simulated", label: "simulated", priceVersionIds: ["github-copilot@2026-10-01"] },
  coverage: coverage(5, 5),
  actionParams: { model: "claude-haiku-5.5", percent: 38, matchPercent: 97 },
  simulation: {
    model: "claude-haiku-5.5",
    selfCheck: { requests: 64, matching: 62, passed: true },
    coverage: { turns: 12, replayedTurns: 12, requests: 64, replayedRequests: 61 },
    assumptions: [{ id: "A1", text: "The replay assumes the same conversation: the same prompts, replies and tool results, whatever the model." }],
  },
});

export function makeSavingsReport(overrides: Partial<SavingsReport> = {}): SavingsReport {
  return {
    window: { since: "2026-10-15", until: "2026-11-13", days: 30 },
    pricing: "as-of-use",
    opportunities: [IDLE_CACHE, UNUSED_TOOLS, FAILED_CALLS, UNPRICED_ROW, CLAUDE_IDLE],
    simulated: [SIMULATED],
    notAnalysed: [{ kind: "unused-tools", providerId: "claude-code", reason: "the logs hold no tool inventory", sessions: 14 }],
    ...overrides,
  };
}
