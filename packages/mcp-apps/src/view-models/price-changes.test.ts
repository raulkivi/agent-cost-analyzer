// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { priceChangeList } from "./increment3-fixtures.js";
import { toPriceChangesViewModel } from "./price-changes.js";

describe("toPriceChangesViewModel", () => {
  it("keeps documented and observed changes in separate lists", () => {
    const vm = toPriceChangesViewModel(priceChangeList());
    expect(vm.documented).toHaveLength(1);
    expect(vm.observed).toHaveLength(1);
    expect(vm.empty).toBe(false);
  });

  it("shows a documented change per token type, with its percent and sources", () => {
    const [change] = toPriceChangesViewModel(priceChangeList()).documented;
    expect(change).toMatchObject({ kind: "documented", inferred: false, dateText: "Oct 15", channel: "github-copilot", modelId: "gpt-5.5", sourceIds: ["src-copilot-models"], note: "Announced in the changelog" });
    expect(change!.lines).toEqual([
      { tokenText: "input", fromText: "$2.00 / 1M", toText: "$2.50 / 1M", percentText: "+25.00 %", direction: "rise" },
      { tokenText: "cache write", fromText: "none", toText: "$3.00 / 1M", direction: "unknown" },
      { tokenText: "output", fromText: "$10.00 / 1M", toText: "$8.00 / 1M", percentText: "−20.00 %", direction: "fall" },
    ]);
  });

  it("shows an observed change as inferred, with its direction and weeks", () => {
    const [change] = toPriceChangesViewModel(priceChangeList()).observed;
    expect(change).toMatchObject({
      kind: "observed",
      inferred: true,
      label: "inferred",
      dateText: "Oct 20",
      modelId: "claude-sonnet-5.5",
      direction: "above",
      percentText: "+12 %",
      weeksText: "2 weeks in a row",
    });
    expect(change!.weeks[0]).toEqual({ period: "2026-W43", turnsText: "40 turns", billedText: "112.00 AI Credits", pricedText: "100.00 AI Credits", ratioText: "1.12 × the price book" });
  });

  it("says plainly that an observed change is not a documented one", () => {
    expect(toPriceChangesViewModel(priceChangeList()).observedNote).toContain("inferred from billed vs priced");
  });

  it("is empty, with a reason, when no change was found", () => {
    const vm = toPriceChangesViewModel(priceChangeList({ changes: [] }));
    expect(vm).toMatchObject({ empty: true, documented: [], observed: [], emptyText: "No price changes found in this period" });
  });

  it("reports providers that were not read", () => {
    const vm = toPriceChangesViewModel(priceChangeList({ providers: [{ id: "pi", label: "pi", available: false, unavailableReason: "no logs", sessionCount: 0, truncated: false }] }));
    expect(vm.issues).toEqual(["pi: no logs"]);
  });

  it("states the period asked for", () => {
    expect(toPriceChangesViewModel(priceChangeList({ since: "2026-10-01", until: "2026-10-31" })).periodText).toBe("Oct 1 – Oct 31");
    expect(toPriceChangesViewModel(priceChangeList()).periodText).toBeUndefined();
  });

  it("reads an observed change above the price book as a rise and one below as a fall", () => {
    const observed = priceChangeList().changes.find((change) => change.kind === "observed")!;
    const below = priceChangeList({ changes: [{ ...observed, direction: "below", percent: -0.1 }] });
    expect(toPriceChangesViewModel(priceChangeList()).observed[0]!.direction).toBe("above");
    expect(toPriceChangesViewModel(below).observed[0]).toMatchObject({ direction: "below", percentText: "−10 %" });
  });

  it("marks a price that did not move as flat, and a missing price as unknown, never as a rise", () => {
    const documented = priceChangeList().changes[0]!;
    if (documented.kind !== "documented") throw new Error("fixture");
    const list = priceChangeList({ changes: [{ ...documented, changes: [{ tier: 0, tokenType: "input", fromUsdPerM: 2, toUsdPerM: 2, percent: 0 }, { tier: 0, tokenType: "output", fromUsdPerM: null, toUsdPerM: null, percent: null }] }] });
    expect(toPriceChangesViewModel(list).documented[0]!.lines.map((line) => line.direction)).toEqual(["flat", "unknown"]);
  });

  describe("filtered to some models (U11 drill-down, up to three by price effect)", () => {
    it("keeps the changes of those models only and says how many of the range it shows", () => {
      const vm = toPriceChangesViewModel(priceChangeList(), { models: ["claude-sonnet-5.5"] });
      expect(vm.documented).toHaveLength(0);
      expect(vm.observed).toHaveLength(1);
      expect(vm.filter).toEqual({ models: ["claude-sonnet-5.5"], shown: 1, total: 2, text: "Showing claude-sonnet-5.5, the model with the largest price effect in the cost change. 1 of 2 changes in the range." });
    });

    it("names two and three models in order", () => {
      expect(toPriceChangesViewModel(priceChangeList(), { models: ["claude-sonnet-5.5", "gpt-5.5"] }).filter?.text).toBe("Showing claude-sonnet-5.5 and gpt-5.5, the 2 models with the largest price effect in the cost change. 2 of 2 changes in the range.");
      expect(toPriceChangesViewModel(priceChangeList(), { models: ["a", "b", "gpt-5.5"] }).filter?.text).toBe("Showing a, b and gpt-5.5, the 3 models with the largest price effect in the cost change. 1 of 2 changes in the range.");
    });

    it("is empty, saying what was asked, when none of the changes is for those models", () => {
      const vm = toPriceChangesViewModel(priceChangeList(), { models: ["other-model"] });
      expect(vm.empty).toBe(true);
      expect(vm.emptyText).toBe("No price changes for other-model in this period; 2 changes in the range are for other models");
    });

    it("matches a model as the log spells it to the price book's id", () => {
      const vm = toPriceChangesViewModel(priceChangeList(), { models: ["claude-sonnet-5-5-20261001"] });
      expect(vm.observed).toHaveLength(1);
      expect(vm.filter).toMatchObject({ shown: 1, total: 2 });
    });

    it("has no filter text without models", () => {
      expect(toPriceChangesViewModel(priceChangeList()).filter).toBeUndefined();
      expect(toPriceChangesViewModel(priceChangeList(), { models: [] }).filter).toBeUndefined();
    });
  });
});
