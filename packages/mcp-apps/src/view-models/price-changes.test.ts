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
      { tokenText: "input", fromText: "$2.00 / 1M", toText: "$2.50 / 1M", percentText: "+25.00 %" },
      { tokenText: "cache write", fromText: "none", toText: "$3.00 / 1M" },
      { tokenText: "output", fromText: "$10.00 / 1M", toText: "$8.00 / 1M", percentText: "−20.00 %" },
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
});
