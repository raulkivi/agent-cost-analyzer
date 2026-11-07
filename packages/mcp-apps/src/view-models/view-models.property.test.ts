// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { toCostRollupViewModel } from "./cost-rollup.js";
import { costRollup, measures, sessionCost, total, turnSeries } from "./fixtures.js";
import { UNKNOWN_TEXT, coverageNote, measureView } from "./format.js";
import { toSessionCostViewModel } from "./session-cost.js";

// Invariants of architecture.md constraint 6 and docs/plans/mcp-apps.md
// §4.3: an unknown value is null and reads "Unknown", never 0; rounding is
// stable; the partial-coverage note appears exactly when coverage is partial.

const credits = fc.double({ min: 0, max: 1_000_000, noNaN: true });
const nullableCredits = fc.option(credits, { nil: null });
const turnCounts = fc.integer({ min: 0, max: 500 }).chain((turns) => fc.tuple(fc.constant(turns), fc.integer({ min: 0, max: turns })));

describe("null never renders as 0", () => {
  it("a null measure reads Unknown, with no estimate tag and no coverage note", () => {
    fc.assert(
      fc.property(turnCounts, fc.boolean(), ([turns, known], estimated) => {
        const view = measureView(total(null, known, turns, estimated), (value) => String(value));
        expect(view).toEqual({ text: UNKNOWN_TEXT, known: false, estimate: false });
      }),
    );
  });

  it("a known measure never reads Unknown, and Unknown is only ever shown for null", () => {
    fc.assert(
      fc.property(nullableCredits, (value) => {
        const view = measureView(total(value, 1, 1), (n) => n.toFixed(2));
        expect(view.text === UNKNOWN_TEXT).toBe(value === null);
        expect(view.known).toBe(value !== null);
      }),
    );
  });

  it("every session tile and chart point follows its source value", () => {
    fc.assert(
      fc.property(nullableCredits, nullableCredits, fc.array(nullableCredits, { maxLength: 30 }), (totalCredits, ratio, perTurn) => {
        const cost = sessionCost({
          totals: measures(10, { aiCredits: total(totalCredits, totalCredits === null ? 0 : 10, 10) }),
          cacheHitRatio: ratio === null ? null : Math.min(1, ratio / 1_000_000),
        });
        const series = turnSeries({
          totalTurns: perTurn.length,
          turns: perTurn.map((aiCredits, turnIndex) => ({
            turnIndex,
            model: "m",
            aiCredits,
            inputTokens: null,
            cacheRead: null,
            output: null,
            estimated: true,
            events: [],
          })),
        });
        const vm = toSessionCostViewModel(cost, series);
        expect(vm.tiles.aiCredits.text === UNKNOWN_TEXT).toBe(totalCredits === null);
        expect(vm.tiles.cacheHit.text === UNKNOWN_TEXT).toBe(ratio === null);
        vm.chart?.points.forEach((point, index) => {
          const source = perTurn[index];
          expect(point.unknown).toBe(source === null);
          expect(point.value).toBe(source);
          expect(point.text === UNKNOWN_TEXT).toBe(source === null);
          // An unknown turn is a gap: no estimate tag on it.
          if (source === null) expect(point.estimate).toBe(false);
        });
      }),
    );
  });

  it("every rollup row and day follows its source value", () => {
    fc.assert(
      fc.property(fc.array(nullableCredits, { minLength: 1, maxLength: 10 }), nullableCredits, (values, grand) => {
        const base = costRollup();
        const template = base.byModel[0]!;
        const rollup = costRollup({
          totals: measures(10, { aiCredits: total(grand, 10, 10) }),
          byModel: values.map((aiCredits, index) => ({ ...template, model: `m${index}`, aiCredits })),
          daily: values.map((aiCredits, index) => ({ ...base.daily[0]!, date: `2026-10-${String((index % 28) + 1).padStart(2, "0")}`, aiCredits })),
        });
        const vm = toCostRollupViewModel(rollup);
        vm.byModel.forEach((row, index) => {
          expect(row.aiCredits.text === UNKNOWN_TEXT).toBe(values[index] === null);
          if (values[index] === null || grand === null || grand <= 0) expect(row.share).toBeNull();
        });
        vm.daily.points.forEach((point, index) => {
          expect(point.unknown).toBe(values[index] === null);
          expect(point.text === UNKNOWN_TEXT).toBe(values[index] === null);
        });
      }),
    );
  });
});

describe("AI Credits rounding is stable", () => {
  it("shows a known amount with exactly 2 decimals, and re-formatting its text changes nothing", () => {
    fc.assert(
      fc.property(credits, (value) => {
        const text = measureView(total(value, 1, 1), (n) => n.toFixed(2)).text;
        const viaTile = toSessionCostViewModel(sessionCost({ totals: measures(1, { aiCredits: total(value, 1, 1) }) })).tiles.aiCredits.text;
        expect(viaTile).toBe(text);
        expect(viaTile).toMatch(/^\d+\.\d{2}$/);
        expect(Number(viaTile).toFixed(2)).toBe(viaTile);
      }),
    );
  });
});

describe("coverage note", () => {
  it("appears exactly when some, but not all, turns are known", () => {
    fc.assert(
      fc.property(turnCounts, ([turns, known]) => {
        const note = coverageNote(known, turns);
        expect(note !== undefined).toBe(known > 0 && known < turns);
        if (note !== undefined) expect(note).toBe(`known for ${known.toLocaleString("en-US")} of ${turns.toLocaleString("en-US")} turns`);
      }),
    );
  });

  it("estimate tag follows the estimated flag for known measures only", () => {
    fc.assert(
      fc.property(nullableCredits, fc.boolean(), (value, estimated) => {
        const view = measureView(total(value, 1, 1, estimated), (n) => n.toFixed(2));
        expect(view.estimate).toBe(value !== null && estimated);
      }),
    );
  });
});
