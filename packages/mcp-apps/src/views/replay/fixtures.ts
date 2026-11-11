// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { SessionReplay, SessionReplayComparison } from "@agent-cost-analyzer/domain";
import { replay, replayComparison } from "../../view-models/increment3-fixtures.js";

// The Replay board's figures (docs/plans/mockups/mcp-apps/Replay.dc.html) as
// tool results, shared by the U12 component, accessibility, keyboard and
// hostile-text tests.

export const NO_TRACE = "no request trace for the turn";

export const entry = (model: string, value: number | null, knownTurns: number, extra: { own?: boolean; replayedTurns?: number; vendorId?: string } = {}) => ({
  model,
  vendorId: extra.vendorId ?? "anthropic",
  total: { value, knownTurns, turns: 42 },
  replayedTurns: extra.replayedTurns ?? knownTurns,
  isMeasuredModel: extra.own ?? false,
});

// The board's comparison: AI Credits, a floor, an unpriced model, a rise.
export function boardComparison(overrides: Partial<SessionReplayComparison> = {}): SessionReplayComparison {
  return replayComparison({
    sessionId: "7f3a9c2e",
    providerId: "copilot",
    currency: "AI_CREDITS",
    measured: { value: 186.4, knownTurns: 42, turns: 42 },
    entries: [
      entry("claude-sonnet-5.5", 183.9, 42, { own: true }),
      entry("claude-haiku-5.5", 38.2, 42),
      entry("gpt-6.1-sol", 132.75, 40, { vendorId: "openai" }),
      entry("local-llama-4", null, 0, { vendorId: "local", replayedTurns: 42 }),
      entry("claude-opus-5.5", 312.8, 42),
    ],
    ...overrides,
  });
}

export const sim = (value: number, outcome: "hit" | "partial" | "miss" = "hit") => ({ cacheRead: 1000, cacheWrite: 100, outcome, cost: { known: true as const, value, currency: "AI_CREDITS" as const } });
export const mea = (value: number) => ({ cacheRead: 1000, cost: { known: true as const, value, currency: "AI_CREDITS" as const, basis: "billed" as const } });
export const lost = { cacheRead: null, cost: { known: false as const, reason: "A request in this turn has no cost figures" } };

// Six turns, two of them (2 and 3) not replayed.
export function boardReplay(overrides: Partial<SessionReplay> = {}): SessionReplay {
  return replay({
    sessionId: "7f3a9c2e",
    providerId: "copilot",
    measuredModels: ["claude-sonnet-5.5"],
    model: "gpt-6.1-sol",
    vendorId: "openai",
    pricing: { channel: "copilot", asOf: "2026-10-14", requested: "session-channel" },
    currency: "AI_CREDITS",
    turns: [
      { turnIndex: 0, measured: mea(2.09), simulated: sim(1.49) },
      { turnIndex: 1, measured: mea(2.3), simulated: sim(1.55, "partial") },
      { turnIndex: 2, measured: mea(4.26), simulated: null, notReplayedReason: NO_TRACE },
      { turnIndex: 3, measured: mea(3.35), simulated: null, notReplayedReason: NO_TRACE },
      { turnIndex: 4, measured: mea(3.71), simulated: sim(2.53) },
      { turnIndex: 5, measured: lost, simulated: sim(2.75, "miss") },
    ],
    totals: { measured: { value: 12.1, knownTurns: 4, turns: 6 }, simulated: { value: 8.32, knownTurns: 4, turns: 6 }, difference: -3.78 },
    coverage: { turns: 6, replayedTurns: 4, requests: 6, replayedRequests: 4, notReplayed: [{ reason: NO_TRACE, turns: 2 }] },
    selfCheck: { model: "claude-sonnet-5.5", requests: 44, matching: 37, readTolerancePercent: 5, passed: false },
    assumptions: [
      { id: "A1", text: "Same conversation: the other model gets the same prompts.", confidence: "unknown" },
      { id: "A2", text: "Same token counts.", confidence: "documented" },
    ],
    ...overrides,
  });
}

