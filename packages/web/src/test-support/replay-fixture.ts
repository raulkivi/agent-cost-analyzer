// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { sessionReplaySchema, type ReplayTurn, type SessionReplay, type VendorProfileSummary } from "@agent-cost-analyzer/domain";

// Phase 14 step 14.7's test data: a Claude Code session of three turns
// replayed on claude-sonnet-5.5, priced at the Anthropic API in USD. Turn 1
// isn't replayed (a request has no complete usage figures). Parsed with the
// domain schema, so a fixture can't drift from what the API sends.

export const NOT_REPLAYED_REASON = "A request in this turn has no complete usage figures";

const replayedTurn = (turnIndex: number, measured: number, simulated: number, outcome: "hit" | "partial" | "miss"): ReplayTurn => ({
  turnIndex,
  measured: { cacheRead: 30_000 + turnIndex, cost: { known: true, value: measured, currency: "USD", basis: "priced" } },
  simulated: { cacheRead: 29_000 + turnIndex, cacheWrite: 1_200 + turnIndex, outcome, cost: { known: true, value: simulated, currency: "USD" } },
});

export function makeReplay(overrides: Partial<SessionReplay> = {}): SessionReplay {
  return sessionReplaySchema.parse({
    simulated: true,
    sessionId: "s1",
    providerId: "claude-code",
    harness: "claude-code",
    measuredModels: ["claude-opus-5.5"],
    model: "claude-sonnet-5.5",
    vendorId: "anthropic",
    pricing: { channel: "api", asOf: "2026-10-21", requested: "session-channel" },
    currency: "USD",
    turns: [
      replayedTurn(0, 0.52, 0.31, "partial"),
      {
        turnIndex: 1,
        measured: { cacheRead: null, cost: { known: false, reason: "A request in this turn has no cost figures" } },
        simulated: null,
        notReplayedReason: NOT_REPLAYED_REASON,
      },
      replayedTurn(2, 0.28, 0.17, "hit"),
    ],
    totals: { measured: { value: 0.8, knownTurns: 2, turns: 3 }, simulated: { value: 0.48, knownTurns: 2, turns: 3 }, difference: -0.32 },
    coverage: { turns: 3, replayedTurns: 2, requests: 9, replayedRequests: 6, notReplayed: [{ reason: NOT_REPLAYED_REASON, turns: 1 }] },
    selfCheck: { model: "claude-opus-5.5", requests: 8, matching: 8, readTolerancePercent: 5, passed: true },
    assumptions: [
      { id: "A1", text: "Same conversation: the other model gets the same prompts. It wouldn't.", confidence: "unknown" },
      { id: "A2", text: "Same token counts: the session's token counts are kept.", confidence: "unknown" },
      { id: "A3", text: "Cold start: the first request reads nothing from the cache.", confidence: "inferred" },
      { id: "A5", text: "Same harness: the session's agent is kept.", confidence: "inferred" },
    ],
    ...overrides,
  });
}

export function makeVendorProfile(vendorId: string, displayName: string, models: [string, boolean][]): VendorProfileSummary {
  return {
    vendorId,
    displayName,
    defaultModelId: models[0]![0],
    models: models.map(([modelId, simulated]) => ({
      modelId,
      displayName: modelId,
      simulated,
      ...(simulated ? {} : { reason: "Caching undocumented, so it can't be simulated" }),
    })),
    assumptions: [],
    sources: [],
    oldestCheckedAt: "2026-11-03",
  };
}

export const REPLAY_PROFILES: VendorProfileSummary[] = [
  makeVendorProfile("anthropic", "Anthropic", [["claude-sonnet-5.5", true], ["claude-opus-5.5", true], ["claude-haiku-5.5", true]]),
  makeVendorProfile("openai", "OpenAI", [["gpt-6.1-sol", true]]),
  makeVendorProfile("moonshot", "Moonshot AI", [["kimi-k3", false]]),
];
