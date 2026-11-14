// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import * as domain from "./index.js";
import { sessionReplayComparisonSchema, sessionReplaySchema, type SessionReplay } from "./session-replay.js";
import type { TokenCount } from "./token-count.js";

// Phase 14 step 14.1 (docs/plans/analyze-session-replay.md §8): what a
// replay returns. The measured side stays beside the simulated one, and
// an unknown is never 0 (constraint 6).
function replay(overrides: Partial<SessionReplay> = {}): SessionReplay {
  return {
    simulated: true,
    sessionId: "s1",
    providerId: "claude-code",
    harness: "claude-code",
    measuredModels: ["claude-sonnet-5.5"],
    model: "gpt-5.6-terra",
    vendorId: "openai",
    pricing: { channel: "api", asOf: "2026-10-07", requested: "session-channel" },
    currency: "USD",
    turns: [
      {
        turnIndex: 0,
        measured: { cacheRead: 9120, cost: { known: true, value: 0.042, currency: "USD", basis: "reported" } },
        simulated: { cacheRead: 9000, cacheWrite: 520, outcome: "hit", cost: { known: true, value: 0.031, currency: "USD" } },
      },
      {
        turnIndex: 2,
        measured: { cacheRead: null, cost: { known: false, reason: "The log has no token counts for this turn." } },
        simulated: null,
        notReplayedReason: "The log has no token counts for this turn.",
      },
    ],
    totals: { measured: { value: 0.042, knownTurns: 1, turns: 2 }, simulated: { value: 0.031, knownTurns: 1, turns: 2 }, difference: -0.011 },
    coverage: { turns: 2, replayedTurns: 1, requests: 2, replayedRequests: 2, notReplayed: [{ reason: "The log has no token counts for this turn.", turns: 1 }] },
    selfCheck: { model: "claude-sonnet-5.5", models: ["claude-sonnet-5.5"], requests: 2, matching: 2, readTolerancePercent: 5, passed: true },
    assumptions: [{ id: "A1", text: "The other model answers with the same number of tokens.", confidence: "inferred" }],
    ...overrides,
  };
}

describe("sessionReplaySchema", () => {
  it("accepts a replay with a replayed and a not-replayed turn", () => {
    expect(sessionReplaySchema.parse(replay())).toEqual(replay());
  });

  it("is always labelled simulated", () => {
    expect(sessionReplaySchema.safeParse({ ...replay(), simulated: false }).success).toBe(false);
  });

  it("gives a not-replayed turn its reason and no simulated figures", () => {
    const [, missing] = replay().turns;
    expect(sessionReplaySchema.safeParse(replay({ turns: [{ ...missing!, notReplayedReason: undefined }] })).success).toBe(false);
    expect(sessionReplaySchema.safeParse(replay({ turns: [{ ...missing!, simulated: replay().turns[0]!.simulated }] })).success).toBe(false);
  });

  it("keeps an unknown total null, never 0, and the difference null with it", () => {
    const unknown = { value: null, knownTurns: 0, turns: 2 };
    expect(sessionReplaySchema.safeParse(replay({ totals: { measured: unknown, simulated: replay().totals.simulated, difference: null } })).success).toBe(true);
    expect(sessionReplaySchema.safeParse(replay({ totals: { measured: unknown, simulated: replay().totals.simulated, difference: 0 } })).success).toBe(false);
    expect(sessionReplaySchema.safeParse(replay({ totals: { ...replay().totals, measured: { value: 0, knownTurns: 0, turns: 2 } } })).success).toBe(false);
  });

  it("can't replay more turns or requests than the session has", () => {
    expect(sessionReplaySchema.safeParse(replay({ coverage: { ...replay().coverage, replayedTurns: 3 } })).success).toBe(false);
    expect(sessionReplaySchema.safeParse(replay({ coverage: { ...replay().coverage, replayedRequests: 3 } })).success).toBe(false);
  });

  it("accepts the subagent runs outside the replay, known or unknown, and omits them when absent (step 10.19)", () => {
    const withRuns = (costAiCredits: TokenCount) => replay({ coverage: { ...replay().coverage, subagentRuns: { runs: 2, costAiCredits } } });
    expect(sessionReplaySchema.safeParse(withRuns({ known: true, value: 54.65 })).success).toBe(true);
    expect(sessionReplaySchema.safeParse(withRuns({ known: false, reason: "a run log is missing" })).success).toBe(true);
    expect(sessionReplaySchema.parse(replay()).coverage.subagentRuns).toBeUndefined();
    expect(sessionReplaySchema.safeParse(replay({ coverage: { ...replay().coverage, subagentRuns: { runs: -1, costAiCredits: { known: true, value: 1 } } } })).success).toBe(false);
  });

  it("passes the self-check only when every request matched", () => {
    expect(sessionReplaySchema.safeParse(replay({ selfCheck: { ...replay().selfCheck!, matching: 1, passed: true } })).success).toBe(false);
    expect(sessionReplaySchema.safeParse(replay({ selfCheck: null })).success).toBe(true);
  });

  it("records an unknown price channel as null with its reason, never a made-up channel (constraint 6)", () => {
    const unknown = { channel: null, reason: "No channel is known for this session.", asOf: "2026-10-07", requested: "session-channel" as const };
    expect(sessionReplaySchema.safeParse(replay({ pricing: unknown })).success).toBe(true);
    expect(sessionReplaySchema.safeParse(replay({ pricing: { ...unknown, reason: undefined } })).success).toBe(false);
    expect(sessionReplaySchema.safeParse(replay({ pricing: { ...unknown, reason: "" } })).success).toBe(false);
    expect(sessionReplaySchema.safeParse(replay({ pricing: { ...replay().pricing, reason: "a known channel has no reason" } })).success).toBe(false);
  });

  it("is exported from the domain index", () => {
    expect(domain.sessionReplaySchema).toBe(sessionReplaySchema);
  });
});

describe("sessionReplayComparisonSchema", () => {
  const comparison = {
    simulated: true as const,
    sessionId: "s1",
    providerId: "claude-code",
    currency: "USD" as const,
    measuredModels: ["claude-sonnet-5.5"],
    measured: { value: 0.042, knownTurns: 1, turns: 2 },
    entries: [
      { model: "claude-sonnet-5.5", vendorId: "anthropic", total: { value: 0.04, knownTurns: 1, turns: 2 }, replayedTurns: 1, isMeasuredModel: true, isMixedSessionModel: false },
      { model: "gpt-5.6-terra", vendorId: "openai", total: { value: 0.031, knownTurns: 1, turns: 2 }, replayedTurns: 1, isMeasuredModel: false, isMixedSessionModel: false },
    ],
  };

  it("needs the models the session used", () => {
    const without: Record<string, unknown> = { ...comparison };
    delete without.measuredModels;
    expect(sessionReplayComparisonSchema.safeParse(without).success).toBe(false);
  });

  it("accepts a mixed session's own entry, flagged mixed with both models named", () => {
    const mixed = {
      ...comparison,
      measuredModels: ["claude-sonnet-5.5", "claude-opus-5.5"],
      entries: [{ ...comparison.entries[0]!, isMeasuredModel: false, isMixedSessionModel: true }, comparison.entries[1]!],
    };
    expect(sessionReplayComparisonSchema.parse(mixed)).toEqual(mixed);
  });

  it("refuses an entry that is both the measured model and a mixed session's", () => {
    const both = { ...comparison, entries: [{ ...comparison.entries[0]!, isMixedSessionModel: true }, comparison.entries[1]!] };
    expect(sessionReplayComparisonSchema.safeParse(both).success).toBe(false);
  });

  it("accepts the subagent runs left out of the comparison, and omits them when absent", () => {
    const runs = { runs: 2, costAiCredits: { known: true as const, value: 3.5 } };
    expect(sessionReplayComparisonSchema.parse({ ...comparison, subagentRuns: runs }).subagentRuns).toEqual(runs);
    expect(sessionReplayComparisonSchema.parse(comparison).subagentRuns).toBeUndefined();
    expect(sessionReplayComparisonSchema.safeParse({ ...comparison, subagentRuns: { runs: -1, costAiCredits: runs.costAiCredits } }).success).toBe(false);
  });

  it("accepts the session's total on several models", () => {
    expect(sessionReplayComparisonSchema.parse(comparison)).toEqual(comparison);
  });

  it("compares at most 10 models (threat-model.md §4)", () => {
    const entries = Array.from({ length: 11 }, (_, i) => ({ ...comparison.entries[1]!, model: `m${i}` }));
    expect(sessionReplayComparisonSchema.safeParse({ ...comparison, entries }).success).toBe(false);
  });

  it("is exported from the domain index", () => {
    expect(domain.sessionReplayComparisonSchema).toBe(sessionReplayComparisonSchema);
  });
});
