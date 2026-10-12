import { describe, expect, it } from "vitest";
import { costRollupSchema, measureTotalSchema, sessionCostSchema } from "./cost.js";

const known = (value: number) => ({ value, knownTurns: 2, turns: 2, estimated: false });
const unknown = { value: null, knownTurns: 0, turns: 2, estimated: false };

const totals = {
  uncachedInput: known(10),
  cacheWrite: known(5),
  cacheRead: known(85),
  inputTokens: known(100),
  reasoning: unknown,
  output: known(20),
  aiCredits: unknown,
};

const figures = { turns: 2, inputTokens: 100, output: 20, aiCredits: null };

function sampleSessionCost() {
  return {
    sessionId: "s1",
    providerId: "claude-code",
    title: "Refactor",
    model: "claude-x",
    startedAt: "2026-09-27T08:00:00.000Z",
    turnCount: 2,
    totals,
    cacheHitRatio: 0.85,
    byModel: [{ model: "claude-x", ...figures }],
    rankedBy: "inputTokens",
    topTurns: [
      { turnIndex: 1, model: "claude-x", triggeredEvent: "compaction", inputTokens: 60, output: 12, aiCredits: null, toolCalls: 3, userMessage: "fix it" },
    ],
    events: [{ turnIndex: 1, event: "compaction" }],
    contextOverhead: {
      systemPrompt: { tokens: 1200, components: [{ kind: "built-in", label: "Base", tokens: 1200 }] },
      toolInventory: { defined: 3, loaded: 3, invoked: 1, neverInvokedCount: 2, neverInvoked: ["a", "b"] },
    },
    unavailableReasons: ["no AI Credits in this log format"],
  };
}

describe("measureTotalSchema", () => {
  it("allows null for an unknown total, never forcing 0", () => {
    expect(measureTotalSchema.parse(unknown).value).toBeNull();
  });

  it("rejects more known turns than turns", () => {
    expect(() => measureTotalSchema.parse({ value: 1, knownTurns: 3, turns: 2, estimated: false })).toThrow();
  });
});

describe("sessionCostSchema", () => {
  it("accepts a full session cost", () => {
    expect(sessionCostSchema.parse(sampleSessionCost())).toEqual(sampleSessionCost());
  });

  it("accepts a context overhead that is only an unavailable reason", () => {
    const cost = { ...sampleSessionCost(), contextOverhead: { unavailableReason: "not recorded" } };
    expect(sessionCostSchema.parse(cost).contextOverhead).toEqual({ unavailableReason: "not recorded" });
  });

  it("rejects a cache hit ratio outside 0..1", () => {
    expect(() => sessionCostSchema.parse({ ...sampleSessionCost(), cacheHitRatio: 1.2 })).toThrow();
  });
});

describe("costRollupSchema", () => {
  it("accepts a cross-provider rollup", () => {
    const rollup = {
      generatedAt: "2026-10-01T00:00:00.000Z",
      since: "2026-09-01",
      providers: [{ id: "claude-code", label: "Claude Code", available: true, sessionCount: 1, truncated: false }],
      sessionCount: 1,
      turnCount: 2,
      totals,
      cacheHitRatio: null,
      byProvider: [{ providerId: "claude-code", providerLabel: "Claude Code", sessions: 1, ...figures }],
      byModel: [{ model: "claude-x", ...figures }],
      daily: [{ date: "2026-09-27", sessions: 1, ...figures }],
      rankedBy: "inputTokens",
      topSessions: [
        { providerId: "claude-code", sessionId: "s1", title: "Refactor", model: "claude-x", startedAt: "2026-09-27T08:00:00.000Z", ...figures },
      ],
    };
    expect(costRollupSchema.parse(rollup)).toEqual(rollup);
  });
});
