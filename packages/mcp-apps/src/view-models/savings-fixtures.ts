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

export function row(overrides: Partial<SavingsRowInput> & Pick<SavingsRowInput, "key" | "kind" | "subject">): SavingsRowInput {
  return {
    rank: 1,
    sessions: refs(["4b81d0aa", "c07e91d4", "e5a3190b"]),
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

export const idleRow = row({ key: "idle:sonnet", kind: "idle-cache-expiry", subject: "claude-sonnet-5.5" });
export const unusedRow = row({
  key: "unused:github",
  rank: 2,
  kind: "unused-tools",
  subject: "github MCP server",
  inferred: true,
  sessionsTotal: 31,
  evidence: { sessions: 31, requests: 877, tokens: { known: true, value: 5400, estimated: true }, occurrences: null },
  perWeek: span(6.2, 38.4),
  perWindow: span(26.7, 165.1),
  coverage: cover(31, 41, "no tool inventory"),
  action: "23 tools from github were loaded but never used in 31 sessions over 30 days. Turn the server off where you do not need it.",
});
export const unpricedRow = row({ key: "failed:git", rank: 5, kind: "failed-tool-calls", subject: "git", perWeek: unpriced, perWindow: unpriced, coverage: cover(40, 41, "no tool-call audit"), action: "Say in your instructions file which directory to run git from." });
export const claudeRow = row({
  key: "idle:opus",
  kind: "idle-cache-expiry",
  subject: "claude-opus-5.5",
  sessions: refs(["cc-1"], "claude-code"),
  sessionsTotal: 1,
  perWeek: upTo(3.2, "USD", ["anthropic-api@2026-09-15"]),
  perWindow: upTo(13.8, "USD", ["anthropic-api@2026-09-15"]),
  coverage: cover(9, 14, "no request trace"),
});
export const simulatedRow = row({
  key: "cheaper:haiku",
  rank: 1,
  kind: "cheaper-model",
  subject: "claude-haiku-5.5",
  sessions: refs(["9d02e4c1", "e61a77f3", "0b7c35d8"]),
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
