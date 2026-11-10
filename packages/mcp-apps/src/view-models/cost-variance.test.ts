// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { costSeries, costVariance, varianceCurrency, varianceModel } from "./cost-analysis-fixtures.js";
import { toCostVarianceViewModel } from "./cost-variance.js";

describe("toCostVarianceViewModel header", () => {
  it("names what changed, both periods, and that the basis is priced as of use", () => {
    const vm = toCostVarianceViewModel(costVariance());
    expect(vm).toMatchObject({
      groupBy: "repository",
      title: "widgets",
      periodA: { label: "2026-09", rangeText: "Sep 1 – Sep 30" },
      periodB: { label: "2026-10", rangeText: "Oct 1 – Oct 31" },
      basisText: "priced",
      pricingText: "prices as of use",
    });
  });

  it("states the conversion only for a usd view", () => {
    expect(toCostVarianceViewModel(costVariance()).conversionNote).toBeUndefined();
    expect(toCostVarianceViewModel(costVariance({ currency: "usd" })).conversionNote).toContain("1 AI Credit = $0.01");
  });
});

describe("toCostVarianceViewModel waterfall", () => {
  it("steps from period A through usage, price and mix to period B", () => {
    const [block] = toCostVarianceViewModel(costVariance()).currencies;
    expect(block?.currency).toBe("AI_CREDITS");
    expect(block?.steps.map((step) => [step.kind, step.value, step.text])).toEqual([
      ["start", 80, "80.00 AI Credits"],
      ["usage", 25, "+25.00 AI Credits"],
      ["price", 10, "+10.00 AI Credits"],
      ["mix", 5, "+5.00 AI Credits"],
      ["end", 120, "120.00 AI Credits"],
    ]);
    expect(block?.changeText).toBe("+40.00 AI Credits (+50.0 %)");
  });

  it("labels each step in plain words", () => {
    const [block] = toCostVarianceViewModel(costVariance()).currencies;
    expect(block?.steps.map((step) => step.label)).toEqual(["2026-09", "More or less usage", "Price changes", "Model mix", "2026-10"]);
  });

  it("writes a decrease with a minus", () => {
    const vm = toCostVarianceViewModel(costVariance({ currencies: [varianceCurrency({ costA: 120, costB: 80, change: -40, usage: -25, price: -10, mix: -5 })] }));
    expect(vm.currencies[0]?.steps[1]?.text).toBe("−25.00 AI Credits");
    expect(vm.currencies[0]?.changeText).toBe("−40.00 AI Credits (−33.3 %)");
  });

  it("says no earlier figure when period A has nothing priced, never a change from 0", () => {
    const vm = toCostVarianceViewModel(costVariance({ currencies: [varianceCurrency({ costA: 0, costB: 40, change: 40, usage: 40, price: 0, mix: 0 })] }));
    const block = vm.currencies[0]!;
    expect(block.noEarlierFigure).toBe(true);
    expect(block.changeText).toBe("no earlier figure");
    expect(block.steps[0]?.text).toBe("no earlier figure");
    expect(block.changePercentText).toBeUndefined();
    expect(JSON.stringify(vm)).not.toMatch(/from 0/i);
  });

  it("keeps currencies in separate blocks", () => {
    const vm = toCostVarianceViewModel(costVariance({ currencies: [varianceCurrency(), varianceCurrency({ currency: "USD", costA: 1, costB: 2, change: 1, usage: 1, price: 0, mix: 0 })] }));
    expect(vm.currencies.map((block) => block.currency)).toEqual(["AI_CREDITS", "USD"]);
    expect(vm.currencies[1]?.steps[4]?.text).toBe("$2.00");
  });
});

describe("toCostVarianceViewModel per-model table", () => {
  it("shows effects and unit prices per token type, with the price versions", () => {
    const [block] = toCostVarianceViewModel(costVariance()).currencies;
    const model = block!.models[0]!;
    expect(model).toMatchObject({ model: "claude-sonnet-5.5", vendorId: "anthropic", costAText: "60.00 AI Credits", costBText: "100.00 AI Credits", changeText: "+40.00 AI Credits", usageText: "+30.00 AI Credits", priceText: "+10.00 AI Credits" });
    expect(model.priceVersionIdsA).toEqual(["v1"]);
    expect(model.priceVersionIdsB).toEqual(["v2"]);
    expect(model.cells[0]).toMatchObject({ tokenText: "uncached input", tokensAText: "1 M", tokensBText: "1.5 M", unitPriceAText: "3.00 AI Credits / 1M", unitPriceBText: "4.00 AI Credits / 1M" });
    expect(model.cells[1]).toMatchObject({ tokenText: "cache write", unitPriceAText: "none", tokensAText: "0" });
  });

  it("totals by token type", () => {
    const [block] = toCostVarianceViewModel(costVariance()).currencies;
    expect(block?.byTokenType[0]).toMatchObject({ tokenText: "uncached input", averagePriceAText: "3.00 AI Credits / 1M", usageText: "+25.00 AI Credits", mixText: "+5.00 AI Credits", priceText: "+10.00 AI Credits" });
  });
});

describe("toCostVarianceViewModel not explained", () => {
  it("counts the unexplained turns per period, with reasons as display only", () => {
    const vm = toCostVarianceViewModel(costVariance());
    expect(vm.notExplained.periodA).toEqual({ turns: 0, turnsText: "all turns explained", displayOnly: { reasons: [] } });
    expect(vm.notExplained.periodB).toEqual({ turns: 3, turnsText: "3 turns without a priced figure are not explained", displayOnly: { reasons: ["no price for mystery-model"] } });
    expect(vm.hasNotExplained).toBe(true);
    expect(JSON.stringify({ ...vm, notExplained: undefined })).not.toContain("mystery-model");
  });

  it("is false when every turn is explained", () => {
    expect(toCostVarianceViewModel(costVariance({ notExplained: { periodA: { turns: 0 }, periodB: { turns: 0 } } })).hasNotExplained).toBe(false);
  });
});

describe("toCostVarianceViewModel price changes", () => {
  it("lists documented changes, marked as documented and not inferred", () => {
    const { priceChanges } = toCostVarianceViewModel(costVariance());
    expect(priceChanges).toHaveLength(1);
    expect(priceChanges[0]).toMatchObject({ kind: "documented", inferred: false, dateText: "Oct 15", modelId: "claude-sonnet-5.5" });
    expect(priceChanges[0]?.lines[0]).toMatchObject({ tokenText: "input", fromText: "$3.00 / 1M", toText: "$4.00 / 1M", percentText: "+33.33 %" });
  });

  it("offers a drill-down to get_price_changes for the models with the largest price effect", () => {
    const vm = toCostVarianceViewModel(
      costVariance({
        currencies: [
          varianceCurrency({
            models: [
              varianceModel({ model: "small", price: 1, change: 1, usage: 0 }),
              varianceModel({ model: "big", price: -9, change: -9, usage: 0 }),
              varianceModel({ model: "none", price: 0, change: 0, usage: 0 }),
              varianceModel({ model: "mid", price: 4, change: 4, usage: 0 }),
              varianceModel({ model: "tiny", price: 0.5, change: 0.5, usage: 0 }),
            ],
          }),
        ],
      }),
    );
    expect(vm.priceDrillDown).toEqual({ tool: "get_price_changes", since: "2026-09-01", until: "2026-10-31", models: ["big", "mid", "small"] });
  });

  it("has no drill-down when no model has a price effect", () => {
    const vm = toCostVarianceViewModel(costVariance({ currencies: [varianceCurrency({ price: 0, usage: 40, mix: 0, models: [varianceModel({ price: 0, usage: 40 })] })], priceChanges: [] }));
    expect(vm.priceDrillDown).toBeUndefined();
    expect(vm.priceChanges).toEqual([]);
  });

  it("never shows an observed change here: the input has documented ones only", () => {
    const observed = costSeries().observedChanges;
    expect(observed).toHaveLength(1); // fixture sanity: observed exist in the series, not in a variance
    expect(toCostVarianceViewModel(costVariance()).priceChanges.every((change) => change.kind === "documented")).toBe(true);
  });
});

describe("toCostVarianceViewModel notes", () => {
  it("surfaces provider problems", () => {
    const vm = toCostVarianceViewModel(costVariance({ providers: [{ id: "pi", label: "pi", available: false, unavailableReason: "no logs found", sessionCount: 0, truncated: false }] }));
    expect(vm.providerIssues).toEqual(["pi: no logs found"]);
  });
});
