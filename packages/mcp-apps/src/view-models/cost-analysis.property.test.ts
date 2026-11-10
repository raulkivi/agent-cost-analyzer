// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { comparisonChange, comparisonRow, costComparison, costSeries, costTotal, costVariance, point, varianceCurrency, varianceModel } from "./cost-analysis-fixtures.js";
import { toCostComparisonViewModel } from "./cost-comparison.js";
import { toCostSeriesViewModel } from "./cost-series.js";
import { toCostVarianceViewModel } from "./cost-variance.js";
import { UNKNOWN_TEXT } from "./format.js";

// Invariants of architecture.md constraint 6 and docs/plans/mcp-apps.md
// §4.5 for the Increment 2 view models: unknown stays unknown, a change
// has no "from 0", the effects add up, every money figure names its basis.

const amount = fc.double({ min: 0, max: 1_000_000, noNaN: true });
const nullableAmount = fc.option(amount, { nil: null });
const basisChoice = fc.constantFrom("preferred", "billed", "reported", "priced" as const);

describe("null never renders as 0 in the series", () => {
  it("every bucket follows its source: unknown is a gap with Unknown text", () => {
    fc.assert(
      fc.property(fc.array(nullableAmount, { minLength: 1, maxLength: 12 }), (values) => {
        const points = values.map((value, index) => {
          const cost = costTotal(value, value === null ? 0 : 3, 3);
          return point(`2026-${String(index + 1).padStart(2, "0")}`, `2026-${String(index + 1).padStart(2, "0")}-01`, `2026-${String(index + 1).padStart(2, "0")}-28`, cost, cost);
        });
        const vm = toCostSeriesViewModel(costSeries({ points }));
        vm.chart.points.forEach((p, index) => {
          const source = values[index];
          expect(p.unknown).toBe(source === null);
          expect(p.cost[0]?.amount).toBe(source);
          expect(p.cost[0]?.text === UNKNOWN_TEXT).toBe(source === null);
        });
      }),
    );
  });

  it("every money view names its basis and, when known, its currency", () => {
    fc.assert(
      fc.property(basisChoice, nullableAmount, fc.constantFrom("native", "usd" as const), (basis, value, currency) => {
        const vm = toCostSeriesViewModel(costSeries({ basis, currency, total: costTotal(value, value === null ? 0 : 5, 5) }));
        for (const money of vm.total) {
          expect(money.basis).toBe(basis);
          expect(money.basisText.length).toBeGreaterThan(0);
          if (money.known) {
            expect(money.currency).not.toBeNull();
            expect(money.text).toMatch(/AI Credits|\$/);
          } else {
            expect(money.text).toBe(UNKNOWN_TEXT);
          }
        }
      }),
    );
  });

  it("a native view never merges currencies: one view per currency present", () => {
    fc.assert(
      fc.property(amount, amount, (credits, usd) => {
        const total = { ...costTotal(credits, 2, 2), amounts: [{ currency: "AI_CREDITS" as const, amount: credits, knownTurns: 2 }, { currency: "USD" as const, amount: usd, knownTurns: 2 }] };
        const vm = toCostSeriesViewModel(costSeries({ total }));
        expect(vm.total.map((money) => money.currency)).toEqual(["AI_CREDITS", "USD"]);
      }),
    );
  });
});

describe("a comparison never changes from 0", () => {
  it("an unknown earlier figure is no earlier figure, with no percentage", () => {
    fc.assert(
      fc.property(nullableAmount, (current) => {
        const row = comparisonRow({ change: [comparisonChange(current, null)] });
        const [change] = toCostComparisonViewModel(costComparison({ rows: [row] })).rows[0]!.change;
        expect(change?.noEarlierFigure).toBe(true);
        expect(change?.text).toBe("no earlier figure");
        expect(change?.percentText).toBeUndefined();
      }),
    );
  });

  it("no change text ever says from 0, and a percentage appears only for a known non-zero earlier figure", () => {
    fc.assert(
      fc.property(nullableAmount, nullableAmount, (current, previous) => {
        const row = comparisonRow({ change: [comparisonChange(current, previous)] });
        const [change] = toCostComparisonViewModel(costComparison({ rows: [row] })).rows[0]!.change;
        expect(change?.text).not.toMatch(/from 0/i);
        expect(change?.noEarlierFigure).toBe(previous === null);
        if (change?.percentText !== undefined) {
          expect(previous).not.toBeNull();
          expect(previous).not.toBe(0);
          expect(current).not.toBeNull();
        }
      }),
    );
  });

  it("drill-down arguments are exactly the input's id, period and view", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), basisChoice, fc.constantFrom("repository", "project" as const), (key, basis, groupBy) => {
        const vm = toCostComparisonViewModel(costComparison({ groupBy, basis, rows: [comparisonRow({ key })] }));
        const { tool, arguments: args } = vm.rows[0]!.drillDown;
        expect(tool).toBe(groupBy === "repository" ? "get_repository_cost" : "get_project_cost");
        expect(args).toMatchObject({ since: "2026-11-01", until: "2026-11-09", basis });
        expect(Object.values(args)).toContain(key);
      }),
    );
  });
});

describe("the variance waterfall adds up", () => {
  const effects = fc.record({ usage: fc.double({ min: -1000, max: 1000, noNaN: true }), price: fc.double({ min: -1000, max: 1000, noNaN: true }), mix: fc.double({ min: -1000, max: 1000, noNaN: true }) });

  it("start + usage + price + mix = end, within float tolerance", () => {
    fc.assert(
      fc.property(fc.double({ min: 2000, max: 5000, noNaN: true }), effects, (costA, { usage, price, mix }) => {
        const change = usage + price + mix;
        const block = toCostVarianceViewModel(costVariance({ currencies: [varianceCurrency({ costA, costB: costA + change, change, usage, price, mix, models: [] })] })).currencies[0]!;
        const [start, ...rest] = block.steps;
        const end = rest.pop()!;
        const sum = start!.value + rest.reduce((total, step) => total + step.value, 0);
        expect(rest.map((step) => step.kind)).toEqual(["usage", "price", "mix"]);
        expect(Math.abs(sum - end.value)).toBeLessThanOrEqual(1e-6 * Math.max(1, end.value));
      }),
    );
  });

  it("a period A of 0 is always no earlier figure, never a percentage", () => {
    fc.assert(
      fc.property(amount, (costB) => {
        const block = toCostVarianceViewModel(costVariance({ currencies: [varianceCurrency({ costA: 0, costB, change: costB, usage: costB, price: 0, mix: 0, models: [varianceModel({ price: 0 })] })] })).currencies[0]!;
        expect(block.noEarlierFigure).toBe(true);
        expect(block.changePercentText).toBeUndefined();
        expect(block.changeText).toBe("no earlier figure");
      }),
    );
  });
});
