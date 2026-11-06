import { describe, expect, it } from "vitest";
import { costVarianceSchema, varianceTokenTypes } from "./cost-variance.js";

// Phase 15 step 15.10 (plan §8.4, D12, §10.1.1 explain_cost_change): the
// change in priced cost between two periods, split into usage (volume),
// price and mix effects that add up exactly to it.

const cell = { tokenType: "output" as const, tokensA: 1_000_000, tokensB: 2_000_000, unitPriceA: 10, unitPriceB: 8, costA: 10, costB: 16, usage: 10, price: -4 };

const variance = {
  generatedAt: "2026-11-06T12:00:00.000Z",
  groupBy: "project" as const,
  id: "app",
  label: "App",
  periodA: { label: "2026-08", since: "2026-08-01", until: "2026-08-31" },
  periodB: { label: "2026-10", since: "2026-10-01", until: "2026-10-31" },
  basis: "priced" as const,
  pricing: "as-of-use" as const,
  currency: "native" as const,
  conversion: "1 AI Credit = $0.01",
  providers: [],
  currencies: [
    {
      currency: "USD" as const,
      costA: 10,
      costB: 16,
      change: 6,
      usage: 10,
      price: -4,
      mix: 0,
      turnsA: 3,
      turnsB: 5,
      byTokenType: [{ tokenType: "output" as const, tokensA: 1_000_000, tokensB: 2_000_000, averagePriceA: 10, usage: 10, mix: 0, price: -4 }],
      models: [
        {
          model: "claude-sonnet-5.5",
          vendorId: "anthropic",
          costA: 10,
          costB: 16,
          change: 6,
          usage: 10,
          price: -4,
          priceVersionIdsA: ["v1"],
          priceVersionIdsB: ["v2"],
          byTokenType: [cell],
        },
      ],
    },
  ],
  notExplained: { periodA: { turns: 0 }, periodB: { turns: 1, reasons: ["Cannot price: unknown model"] } },
  priceChanges: [],
};

describe("costVarianceSchema", () => {
  it("accepts a variance whose effects add up to the change", () => {
    expect(costVarianceSchema.parse(variance).currencies[0]?.change).toBe(6);
  });

  it("refuses effects that don't add up to the change (D12: exactly, to rounding)", () => {
    const wrong = { ...variance, currencies: [{ ...variance.currencies[0]!, mix: 1 }] };
    expect(() => costVarianceSchema.parse(wrong)).toThrow(/add up/);
  });

  it("refuses a model whose usage and price don't add up to its change", () => {
    const model = { ...variance.currencies[0]!.models[0]!, price: -3 };
    const wrong = { ...variance, currencies: [{ ...variance.currencies[0]!, models: [model] }] };
    expect(() => costVarianceSchema.parse(wrong)).toThrow(/add up/);
  });

  it("names the four token types the pricer charges", () => {
    expect(varianceTokenTypes).toEqual(["uncachedInput", "cacheRead", "cacheWrite", "output"]);
  });
});
