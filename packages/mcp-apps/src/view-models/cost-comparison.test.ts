// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { comparisonChange, comparisonRow, costComparison, costTotal } from "./cost-analysis-fixtures.js";
import { toCostComparisonViewModel } from "./cost-comparison.js";

describe("toCostComparisonViewModel header", () => {
  it("states both periods, how the earlier one was chosen, basis and pricing", () => {
    const vm = toCostComparisonViewModel(costComparison());
    expect(vm).toMatchObject({
      groupBy: "repository",
      periodText: "Nov 1 – Nov 9",
      previousPeriodText: "Oct 23 – Oct 31",
      comparePeriodText: "previous period",
      basisText: "preferred (billed, else reported, else priced)",
      pricingText: "prices as of use",
    });
    expect(toCostComparisonViewModel(costComparison({ comparePeriod: "last-year" })).comparePeriodText).toBe("same dates last year");
    expect(vm.total[0]).toMatchObject({ text: "160.00 AI Credits", basis: "preferred", coverageNote: "known for 70 of 76 turns" });
  });
});

describe("toCostComparisonViewModel rows", () => {
  it("ranks the most expensive first and keeps unknown last", () => {
    const vm = toCostComparisonViewModel(costComparison({ rows: [comparisonRow({ key: "none", label: "none", total: costTotal(null, 0, 3) }), comparisonRow({ key: "a", label: "a", total: costTotal(5, 3, 3) }), comparisonRow({ key: "b", label: "b", total: costTotal(50, 3, 3) })] }));
    expect(vm.rows.map((row) => row.key)).toEqual(["b", "a", "none"]);
  });

  it("writes the per-measure figures with basis and unit, and the share bar", () => {
    const row = toCostComparisonViewModel(costComparison()).rows[0]!;
    expect(row).toMatchObject({ label: "widgets", sessionsText: "9 sessions", turnsText: "46 turns", activeDaysText: "5 active days" });
    expect(row.total[0]).toMatchObject({ text: "100.00 AI Credits", basis: "preferred", coverageNote: "known for 38 of 46 turns" });
    expect(row.perSession[0]).toMatchObject({ text: "11.11 AI Credits", basis: "preferred" });
    expect(row.perActiveDay[0]?.text).toBe("20.00 AI Credits");
    expect(row.perTurn[0]?.text).toBe("2.17 AI Credits");
    expect(row.shares).toEqual([{ currency: "AI_CREDITS", share: 0.625, text: "63 %" }]);
    expect(row.cacheHit).toEqual({ text: "81 %", known: true, estimate: false });
    expect(row.outputShare.text).toBe("4 %");
  });

  it("reads Unknown for a missing cache-hit ratio and empty measures", () => {
    const row = toCostComparisonViewModel(costComparison({ rows: [comparisonRow({ cacheHitRatio: null, perTurn: [], total: costTotal(null, 0, 4), change: [] })] })).rows[0]!;
    expect(row.cacheHit).toMatchObject({ text: "Unknown", known: false });
    expect(row.perTurn[0]).toMatchObject({ text: "Unknown", known: false });
    expect(row.total[0]).toMatchObject({ text: "Unknown", known: false });
  });

  it("keeps currencies apart in a native view", () => {
    const mixed = { ...costTotal(10, 4, 4), amounts: [{ currency: "AI_CREDITS" as const, amount: 10, knownTurns: 4 }, { currency: "USD" as const, amount: 3, knownTurns: 4 }] };
    const row = toCostComparisonViewModel(costComparison({ rows: [comparisonRow({ total: mixed })] })).rows[0]!;
    expect(row.total.map((money) => money.text)).toEqual(["10.00 AI Credits", "$3.00"]);
  });
});

describe("toCostComparisonViewModel change", () => {
  it("writes an increase with its percentage", () => {
    const [change] = toCostComparisonViewModel(costComparison()).rows[0]!.change;
    expect(change).toMatchObject({ currency: "AI_CREDITS", noEarlierFigure: false, text: "+20.00 AI Credits (+25.0 %)", percentText: "+25.0 %", direction: "up" });
  });

  it("writes a decrease with a minus", () => {
    const row = comparisonRow({ change: [comparisonChange(60, 80)] });
    expect(toCostComparisonViewModel(costComparison({ rows: [row] })).rows[0]?.change[0]).toMatchObject({ text: "−20.00 AI Credits (−25.0 %)", direction: "down" });
  });

  it("says no earlier figure when the earlier period is unknown, never a change from 0", () => {
    const row = comparisonRow({ change: [comparisonChange(100, null)], previous: { sessions: 0, turns: 5, total: costTotal(null, 0, 5), coverage: comparisonRow().previous.coverage } });
    const [change] = toCostComparisonViewModel(costComparison({ rows: [row] })).rows[0]!.change;
    expect(change).toMatchObject({ noEarlierFigure: true, text: "no earlier figure" });
    expect(change?.percentText).toBeUndefined();
    expect(change?.absoluteText).toBeUndefined();
  });

  it("says no earlier figure when the change list is empty because nothing was known", () => {
    const row = comparisonRow({ change: [] });
    expect(toCostComparisonViewModel(costComparison({ rows: [row] })).rows[0]?.change).toEqual([{ currency: null, noEarlierFigure: true, text: "no earlier figure" }]);
  });

  it("gives no percentage when the earlier figure is a known 0, and does not say from 0", () => {
    const row = comparisonRow({ change: [comparisonChange(5, 0)] });
    const [change] = toCostComparisonViewModel(costComparison({ rows: [row] })).rows[0]!.change;
    expect(change?.percentText).toBeUndefined();
    expect(change?.text).toBe("+5.00 AI Credits");
    expect(change?.text).not.toMatch(/from 0/i);
  });

  it("reads Unknown when the current figure is unknown", () => {
    const row = comparisonRow({ change: [comparisonChange(null, 80)] });
    expect(toCostComparisonViewModel(costComparison({ rows: [row] })).rows[0]?.change[0]).toMatchObject({ text: "Unknown", noEarlierFigure: false });
  });

  it("shows the earlier period's total with its coverage", () => {
    const row = toCostComparisonViewModel(costComparison()).rows[0]!;
    expect(row.previousTotal[0]).toMatchObject({ text: "80.00 AI Credits", basis: "preferred" });
  });
});

describe("toCostComparisonViewModel drill-down", () => {
  it("carries the arguments get_repository_cost needs, from the input only", () => {
    const row = toCostComparisonViewModel(costComparison()).rows[0]!;
    expect(row.drillDown).toEqual({
      tool: "get_repository_cost",
      arguments: { repository: "github.com/acme/widgets", since: "2026-11-01", until: "2026-11-09", basis: "preferred", pricing: "as-of-use", currency: "native" },
    });
  });

  it("uses get_project_cost and projectId for projects", () => {
    const vm = toCostComparisonViewModel(costComparison({ groupBy: "project", basis: "billed", currency: "usd", pricing: "today", rows: [comparisonRow({ key: "p1", label: "Acme" })] }));
    expect(vm.rows[0]?.drillDown).toEqual({
      tool: "get_project_cost",
      arguments: { projectId: "p1", since: "2026-11-01", until: "2026-11-09", basis: "billed", pricing: "today", currency: "usd" },
    });
  });

  it("shows the folder name only, as returned", () => {
    const vm = toCostComparisonViewModel(costComparison({ rows: [comparisonRow({ key: "/home/me/src/widgets", label: "widgets" })] }));
    expect(vm.rows[0]?.label).toBe("widgets");
    const { drillDown, key, ...rest } = vm.rows[0]!;
    expect(key).toBe("/home/me/src/widgets");
    expect(drillDown.arguments).toMatchObject({ repository: "/home/me/src/widgets" });
    expect(JSON.stringify(rest)).not.toContain("/home/me");
  });
});

describe("toCostComparisonViewModel notes", () => {
  it("surfaces undated turns, provider problems, and the conversion in a usd view", () => {
    const vm = toCostComparisonViewModel(
      costComparison({ undatedTurns: 1, currency: "usd", providers: [{ id: "pi", label: "pi", available: false, unavailableReason: "no logs found", sessionCount: 0, truncated: false }] }),
    );
    expect(vm.undatedNote).toBe("1 turn has no date and is in neither period");
    expect(vm.providerIssues).toEqual(["pi: no logs found"]);
    expect(vm.conversionNote).toContain("1 AI Credit = $0.01");
    expect(toCostComparisonViewModel(costComparison()).conversionNote).toBeUndefined();
  });
});
