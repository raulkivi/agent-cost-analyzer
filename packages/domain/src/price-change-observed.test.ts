import { describe, expect, it } from "vitest";
import { observedPriceChangeSchema, priceChangeListSchema } from "./price-change.js";

// Phase 15 step 15.10 (plan §6.4 point 2, D11, §10.1.1 get_price_changes):
// an observed price change is a steady gap between what GitHub billed and
// what the price book gives for the same Copilot turns. It is inferred
// evidence, never a price by itself.

const week = (period: string, start: string, ratio: number) => ({
  period,
  start,
  end: start.replace(/\d\d$/, (day) => String(Number(day) + 6).padStart(2, "0")),
  turns: 25,
  billedAiCredits: 112 * (ratio / 1.12),
  pricedAiCredits: 100,
  ratio,
});

const observed = {
  kind: "observed" as const,
  date: "2026-10-12",
  channel: "github-copilot",
  modelId: "claude-sonnet-5.5",
  direction: "above" as const,
  percent: 12,
  weeks: [week("2026-W42", "2026-10-12", 1.12), week("2026-W43", "2026-10-19", 1.12)],
  priceVersionIds: ["github-copilot:claude-sonnet-5.5:2026-10-07"],
  confidence: "inferred" as const,
};

describe("observedPriceChangeSchema", () => {
  it("accepts a run of weeks with its direction, size and evidence", () => {
    expect(observedPriceChangeSchema.parse(observed)).toEqual(observed);
  });

  it("needs at least the two weeks D11 asks for", () => {
    expect(() => observedPriceChangeSchema.parse({ ...observed, weeks: [observed.weeks[0]] })).toThrow();
  });

  it("is always inferred", () => {
    expect(() => observedPriceChangeSchema.parse({ ...observed, confidence: "documented" })).toThrow();
  });
});

describe("priceChangeListSchema", () => {
  it("lists documented and observed changes side by side, with the providers read", () => {
    const list = {
      generatedAt: "2026-11-06T12:00:00.000Z",
      since: "2026-10-01",
      providers: [],
      changes: [
        {
          kind: "documented",
          date: "2026-10-07",
          channel: "github-copilot",
          modelId: "claude-sonnet-5.5",
          fromVersionId: "a",
          toVersionId: "b",
          changes: [{ tier: 0, tokenType: "cachedInput", fromUsdPerM: 0.3, toUsdPerM: 0.15, percent: -50 }],
          sourceIds: ["s"],
        },
        observed,
      ],
    };
    expect(priceChangeListSchema.parse(list).changes.map((change) => change.kind)).toEqual(["documented", "observed"]);
  });
});

describe("price-change findings", () => {
  it("is a finding kind of its own (plan §10.1.2 list_findings kind)", async () => {
    const { findingKindSchema } = await import("./insights.js");
    expect(findingKindSchema.parse("price-change")).toBe("price-change");
  });
});

describe("cost series observed changes", () => {
  it("carries observed changes beside the documented markers (dashed on charts)", async () => {
    const { costSeriesSchema } = await import("./cost-analysis.js");
    expect(Object.keys(costSeriesSchema.shape)).toContain("observedChanges");
  });
});
