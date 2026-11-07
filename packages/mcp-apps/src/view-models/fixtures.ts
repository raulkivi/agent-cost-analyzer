// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { costBasisTotals } from "@agent-cost-analyzer/domain";
import type { CostMeasures, CostRollup, MeasureTotal, SessionCost, TurnSeries } from "@agent-cost-analyzer/domain";

// Test fixtures for the view-model tests: invented sessions and figures.

export function total(value: number | null, knownTurns: number, turns: number, estimated = false): MeasureTotal {
  return { value, knownTurns, turns, estimated };
}

export function measures(turns: number, overrides: Partial<CostMeasures> = {}): CostMeasures {
  const known = total(1000, turns, turns);
  return {
    uncachedInput: known,
    cacheWrite: known,
    cacheRead: known,
    inputTokens: known,
    reasoning: known,
    output: known,
    aiCredits: total(1, turns, turns),
    ...overrides,
  };
}

export const NO_COST = costBasisTotals([]);

export function sessionCost(overrides: Partial<SessionCost> = {}): SessionCost {
  return {
    sessionId: "7f3a9c2e",
    title: "Refactor provider registry",
    model: "claude-sonnet-5.5",
    startedAt: "2026-10-27T14:00:00Z",
    turnCount: 42,
    totals: measures(42, {
      aiCredits: total(18.42, 40, 42),
      inputTokens: total(2_100_000, 42, 42),
      output: total(64_000, 42, 42, true),
    }),
    cost: NO_COST,
    cacheHitRatio: 0.87,
    byModel: [],
    rankedBy: "aiCredits",
    topTurns: [
      {
        turnIndex: 17,
        model: "claude-sonnet-5.5",
        triggeredEvent: "compaction",
        inputTokens: 310_412,
        output: 3108,
        aiCredits: 4.1,
        toolCalls: 6,
        userMessage: "Rewrite the decoder to stream frames instead of…",
        cost: NO_COST_FIGURES(),
      },
      {
        turnIndex: 5,
        model: "claude-sonnet-5.5",
        triggeredEvent: "model-switch",
        inputTokens: 240_000,
        output: null,
        aiCredits: 2.95,
        toolCalls: null,
        userMessage: "Add tests for the provider fallback order and…",
        cost: NO_COST_FIGURES(),
      },
      {
        turnIndex: 29,
        model: "claude-sonnet-5.5",
        inputTokens: null,
        output: null,
        aiCredits: null,
        toolCalls: null,
        userMessage: "Split the registry into a read side and a write…",
        cost: NO_COST_FIGURES(),
      },
    ],
    events: [],
    contextOverhead: {
      systemPrompt: { tokens: 21_000, components: [{ kind: "repo-instructions", label: "Custom instructions", tokens: 3000 }, { kind: "tool-definitions", label: "Tool definitions", tokens: null }] },
      toolInventory: { defined: 52, loaded: 52, invoked: 38, neverInvokedCount: 14, neverInvoked: ["secret_tool_name"] },
    },
    unavailableReasons: [],
    ...overrides,
  };
}

function NO_COST_FIGURES(): SessionCost["topTurns"][number]["cost"] {
  const unknown = { known: false as const, reason: "no data" };
  return { billed: unknown, reported: unknown, priced: unknown };
}

export function turnSeries(overrides: Partial<TurnSeries> = {}): TurnSeries {
  return {
    sessionId: "7f3a9c2e",
    totalTurns: 4,
    truncated: false,
    turns: [
      { turnIndex: 0, model: "m", aiCredits: 0.5, inputTokens: 100, cacheRead: 50, output: 10, estimated: false, events: [] },
      { turnIndex: 1, model: "m", aiCredits: null, inputTokens: null, cacheRead: null, output: null, estimated: false, events: [] },
      { turnIndex: 2, model: "m2", aiCredits: 4.1, inputTokens: 310_000, cacheRead: 268_000, output: 3108, estimated: true, events: ["compaction", "model-switch"] },
      { turnIndex: 3, model: "m2", aiCredits: 0, inputTokens: 0, cacheRead: 0, output: 0, estimated: false, events: [] },
    ],
    ...overrides,
  };
}

export function costRollup(overrides: Partial<CostRollup> = {}): CostRollup {
  const figures = (turns: number, aiCredits: number | null) => ({ turns, inputTokens: null, output: null, aiCredits, cost: NO_COST.preferred });
  return {
    generatedAt: "2026-11-02T12:00:00Z",
    since: "2026-10-27T00:00:00Z",
    until: "2026-11-02T00:00:00Z",
    providers: [],
    sessionCount: 23,
    turnCount: 334,
    totals: measures(334, { aiCredits: total(142.6, 318, 334) }),
    cost: NO_COST,
    cacheHitRatio: 0.81,
    byProvider: [
      { ...figures(200, 96.2), providerId: "copilot", providerLabel: "Copilot Chat", sessions: 12 },
      { ...figures(100, 39.85), providerId: "claude-code", providerLabel: "Claude Code", sessions: 9 },
      { ...figures(34, null), providerId: "pi", providerLabel: "pi", sessions: 2 },
    ],
    byModel: [
      { ...figures(250, 88.1), model: "claude-sonnet-5.5" },
      { ...figures(60, 31.45), model: "gpt-6.1-sol" },
      { ...figures(24, null), model: "mystery-model" },
    ],
    daily: [
      { ...figures(100, 30), date: "2026-10-27", sessions: 5 },
      { ...figures(0, null), date: "2026-10-28", sessions: 0 },
      { ...figures(234, 112.6), date: "2026-10-29", sessions: 18 },
    ],
    rankedBy: "aiCredits",
    topSessions: [
      {
        ...figures(42, 18.42),
        cost: { ...NO_COST.preferred, turns: 42, knownTurns: 40 },
        providerId: "copilot",
        sessionId: "7f3a9c2e",
        title: "Refactor provider registry",
        model: "claude-sonnet-5.5",
        startedAt: "2026-10-27T14:00:00Z",
      },
      { ...figures(9, null), providerId: "pi", sessionId: "abc", title: "Draft release notes", model: "gpt-6.1-sol" },
    ],
    byRepository: [],
    byProject: [],
    byVendor: [],
    byChannel: [],
    reconciliation: [],
    ...overrides,
  };
}
