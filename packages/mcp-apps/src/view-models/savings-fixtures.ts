// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { SavingsAmount } from "@agent-cost-analyzer/domain";
import type { SavingsRowInput, SavingsViewInput } from "./savings.js";

// Invented figures shaped like the SR18 boards (docs/plans/mockups/mcp-apps/Savings.dc.html),
// in the form get_savings_report returns them in structuredContent.

const VSCODE = "vscode";
const price = ["github-copilot@2026-10-01"];

export const upTo = (high: number, currency: "AI_CREDITS" | "USD" = "AI_CREDITS", versions: string[] = price): SavingsAmount => ({ known: true, currency, low: 0, high, basis: "priced", label: "upper-bound", priceVersionIds: versions });
export const span = (low: number, high: number, currency: "AI_CREDITS" | "USD" = "AI_CREDITS", versions: string[] = price): SavingsAmount => ({ known: true, currency, low, high, basis: "priced", label: "range", priceVersionIds: versions });
export const unpriced: SavingsAmount = { known: false, reason: "no price for gpt-5.1-codex on 2026-10-22" };

const cover = (analysed: number, total: number, reason?: string) => ({ sessionsInWindow: total, sessionsAnalysed: analysed, notAnalysed: reason !== undefined && total > analysed ? [{ reason, sessions: total - analysed }] : [] });
export const refs = (ids: string[], providerId = VSCODE) => ids.map((sessionId) => ({ providerId, sessionId }));
// V24: a session with its start (midday UTC, the same day in any time zone) and its saving over the window.
export const dated = (sessionId: string, startedAt: string | undefined, perWindow: SavingsAmount, providerId = VSCODE) => ({ providerId, sessionId, ...(startedAt === undefined ? {} : { startedAt }), perWindow });

export function row(overrides: Partial<SavingsRowInput> & Pick<SavingsRowInput, "key" | "kind" | "subject">): SavingsRowInput {
  return {
    sessions: [dated("4b81d0aa", "2026-11-11T12:00:00.000Z", upTo(61.2)), dated("c07e91d4", "2026-11-06T12:00:00.000Z", upTo(40.5)), dated("e5a3190b", undefined, unpriced)],
    sessionsTotal: 11,
    evidence: { sessions: 11, requests: 877, tokens: { known: true, value: 412000 }, occurrences: 11 },
    perWeek: upTo(46),
    perWindow: upTo(197.8),
    coverage: cover(38, 41, "no request trace"),
    action: "11 breaks after an idle gap resent about 412000 tokens uncached. Resuming a long session after a break resends all of it: start a new session with a short summary before the break.",
    inferred: false,
    ...overrides,
  };
}

export const idleRow = row({ key: "idle:sonnet", rank: 1, kind: "idle-cache-expiry", subject: "claude-sonnet-5.5" });
export const unusedRow = row({
  key: "unused:github",
  rank: 2,
  kind: "unused-tools",
  subject: "github MCP server",
  inferred: true,
  sessions: [dated("4b81d0aa", "2026-11-11T12:00:00.000Z", span(3.9, 24)), dated("c07e91d4", "2026-11-06T12:00:00.000Z", span(2.1, 12.8)), dated("e5a3190b", "2026-11-02T12:00:00.000Z", span(1.6, 9.9))],
  sessionsTotal: 31,
  evidence: { sessions: 31, requests: 877, tokens: { known: true, value: 5400, estimated: true }, occurrences: null },
  perWeek: span(6.2, 38.4),
  perWindow: span(26.7, 165.1),
  coverage: cover(31, 41, "no tool inventory"),
  action: "23 tools from github were loaded but never used in 31 sessions over 30 days. Turn the server off where you do not need it.",
  // V26 (board Savings.dc.html frames 5 and 6): 7 of the 23 tools in the result; the view shows 5.
  tools: [
    ["mcp_github_create_pull_request", 610, 31],
    ["mcp_github_search_code", 540, 31],
    ["mcp_github_list_issues", 480, 29],
    ["mcp_github_get_file_contents", 455, 31],
    ["mcp_github_list_commits", 430, 24],
    ["mcp_github_get_me", 300, 31],
    ["mcp_github_fork_repository", 200, 12],
  ].map(([name, value, sessions]) => ({ name: name as string, tokens: { known: true as const, value: value as number, estimated: true as const }, sessions: sessions as number })),
  toolsTotal: 23,
});
export const unpricedRow = row({ key: "failed:git", rank: 5, kind: "failed-tool-calls", subject: "git", perWeek: unpriced, perWindow: unpriced, coverage: cover(40, 41, "no tool-call audit"), action: "Say in your instructions file which directory to run git from." });
export const claudeRow = row({
  key: "idle:opus",
  kind: "idle-cache-expiry",
  subject: "claude-opus-5.5",
  sessions: [dated("cc-1", "2026-11-02T12:00:00.000Z", upTo(13.8, "USD", ["anthropic-api@2026-09-15"]), "claude-code")],
  sessionsTotal: 1,
  perWeek: upTo(3.2, "USD", ["anthropic-api@2026-09-15"]),
  perWindow: upTo(13.8, "USD", ["anthropic-api@2026-09-15"]),
  coverage: cover(9, 14, "no request trace"),
});
export const simulatedRow = row({
  key: "cheaper:haiku",
  kind: "cheaper-model",
  subject: "claude-haiku-5.5",
  sessions: [
    dated("9d02e4c1", "2026-11-09T12:00:00.000Z", { known: true, currency: "AI_CREDITS", low: 48, high: 52, basis: "simulated", label: "simulated", priceVersionIds: price }),
    dated("e61a77f3", "2026-11-04T12:00:00.000Z", { known: true, currency: "AI_CREDITS", low: 31, high: 33, basis: "simulated", label: "simulated", priceVersionIds: price }),
    dated("0b7c35d8", "2026-10-29T12:00:00.000Z", { known: true, currency: "AI_CREDITS", low: 28.1, high: 32.8, basis: "simulated", label: "simulated", priceVersionIds: price }),
  ],
  sessionsTotal: 5,
  evidence: { sessions: 5, requests: 224, tokens: null, occurrences: 38 },
  perWeek: { known: true, currency: "AI_CREDITS", low: 24.9, high: 27.4, basis: "simulated", label: "simulated", priceVersionIds: price },
  perWindow: { known: true, currency: "AI_CREDITS", low: 107.1, high: 117.8, basis: "simulated", label: "simulated", priceVersionIds: price },
  coverage: cover(5, 5),
  action: "Replayed on claude-haiku-5.5, the same conversation would have cost about 21% of what it did (Simulated).",
  simulation: {
    model: "claude-haiku-5.5",
    selfCheck: { requests: 224, matching: 217, passed: true },
    coverage: { turns: 38, replayedTurns: 38, requests: 224, replayedRequests: 218 },
    assumptions: [{ id: "A1", text: "The replay assumes the same conversation: the same prompts, replies and tool results, whatever the model." }],
  },
});

export function savingsOutput(overrides: Partial<SavingsViewInput> = {}): SavingsViewInput {
  return {
    window: { since: "2026-10-15", until: "2026-11-13", days: 30 },
    pricing: "as-of-use",
    includeSimulated: false,
    opportunities: [idleRow, unusedRow, unpricedRow],
    opportunitiesTotal: 3,
    simulated: [],
    simulatedTotal: 0,
    notAnalysed: [{ kind: "idle-cache-expiry", providerId: "vscode", reason: "no request trace", sessions: 7 }],
    ...overrides,
  };
}

export const twoCurrencyOutput = (): SavingsViewInput => savingsOutput({ opportunities: [idleRow, unusedRow, claudeRow], opportunitiesTotal: 9 });
