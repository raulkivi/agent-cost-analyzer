// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { costRollupSchema, measureTotalSchema, sessionCostSchema, turnSeriesSchema } from "./cost.js";
import { costBasisTotals, sumCostFigures, type TurnCostFigures } from "./cost-figure.js";

const turnCost: TurnCostFigures = {
  billed: { known: false, reason: "Claude Code has no billed figure." },
  reported: { known: false, reason: "Claude Code logs no cost of its own." },
  priced: { known: true, amount: 0.5, currency: "USD", basis: "priced", priceVersionIds: ["anthropic-api:claude-x:2026-10-01"], apiEquivalent: true },
};
const basisTotals = costBasisTotals([turnCost, turnCost]);

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

const figures = { turns: 2, inputTokens: 100, output: 20, aiCredits: null, cost: sumCostFigures([turnCost.priced, turnCost.priced]) };

function sampleSessionCost() {
  return {
    sessionId: "s1",
    providerId: "claude-code",
    title: "Refactor",
    model: "claude-x",
    startedAt: "2026-09-27T08:00:00.000Z",
    turnCount: 2,
    repositoryKey: "github.com/acme/portal",
    projectId: "acme-portal",
    totals,
    cost: basisTotals,
    cacheHitRatio: 0.85,
    byModel: [{ model: "claude-x", ...figures }],
    rankedBy: "inputTokens",
    topTurns: [
      { turnIndex: 1, model: "claude-x", triggeredEvent: "compaction", inputTokens: 60, output: 12, aiCredits: null, toolCalls: 3, userMessage: "fix it", cost: turnCost },
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

  it("carries an Unattributed session's reason (step 15.6)", () => {
    const cost = { ...sampleSessionCost(), repositoryKey: null, unattributedReason: "no folder", projectId: null };
    expect(sessionCostSchema.parse(cost)).toEqual(cost);
  });

  it("requires per-basis cost totals and a cost on every top turn (step 15.6)", () => {
    const { cost, ...withoutCost } = sampleSessionCost();
    expect(cost.priced.knownTurns).toBe(2);
    expect(sessionCostSchema.safeParse(withoutCost).success).toBe(false);
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
      cost: basisTotals,
      cacheHitRatio: null,
      byProvider: [{ providerId: "claude-code", providerLabel: "Claude Code", sessions: 1, ...figures }],
      byModel: [{ model: "claude-x", ...figures }],
      daily: [{ date: "2026-09-27", sessions: 1, ...figures }],
      rankedBy: "inputTokens",
      topSessions: [
        { providerId: "claude-code", sessionId: "s1", title: "Refactor", model: "claude-x", startedAt: "2026-09-27T08:00:00.000Z", ...figures },
      ],
      byRepository: [{ key: "github.com/acme/portal", label: "github.com/acme/portal", turns: 2, cost: basisTotals }],
      byProject: [{ key: null, label: "No project", reason: "No project's member matches.", turns: 2, cost: basisTotals }],
      byVendor: [{ key: "anthropic", label: "Anthropic", turns: 2, cost: basisTotals }],
      byChannel: [{ key: "anthropic-api", label: "Anthropic API", turns: 2, cost: basisTotals }],
      reconciliation: [
        {
          month: "2026-10",
          model: "claude-sonnet-5.5",
          turns: 1,
          billedAiCredits: 10,
          pricedAiCredits: 9,
          difference: 1,
          ratio: 1.111111111,
          billedOnlyTurns: 0,
          priceVersionIds: ["github-copilot:claude-sonnet-5.5:2026-10-07"],
        },
      ],
    };
    expect(costRollupSchema.parse(rollup)).toEqual(rollup);
  });
});

describe("turnSeriesSchema", () => {
  const series = {
    sessionId: "s1",
    turns: [
      { turnIndex: 0, startedAt: "2026-09-27T08:00:00.000Z", model: "m", aiCredits: 1.5, inputTokens: 100, cacheRead: 90, output: 5, estimated: false, events: ["compaction" as const] },
      { turnIndex: 1, model: "m", aiCredits: null, inputTokens: null, cacheRead: null, output: null, estimated: false, events: [] },
    ],
    totalTurns: 2,
    truncated: false,
  };

  it("round-trips a series whose unknown figures are null", () => {
    expect(turnSeriesSchema.parse(series)).toEqual(series);
  });

  it("accepts an empty session", () => {
    const empty = { sessionId: "s1", turns: [], totalTurns: 0, truncated: false };
    expect(turnSeriesSchema.parse(empty)).toEqual(empty);
  });

  it("rejects an omitted figure, a missing flag and an unknown event", () => {
    const noCredits: Record<string, unknown> = { ...series.turns[1] };
    delete noCredits.aiCredits;
    expect(() => turnSeriesSchema.parse({ ...series, turns: [noCredits] })).toThrow();
    expect(() => turnSeriesSchema.parse({ ...series, truncated: undefined })).toThrow();
    expect(() => turnSeriesSchema.parse({ ...series, turns: [{ ...series.turns[0], events: ["bogus"] }] })).toThrow();
  });
});
