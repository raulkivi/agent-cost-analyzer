// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Currency } from "@agent-cost-analyzer/domain";
import { toEstimateViewModel } from "./estimate.js";
import { UNKNOWN_TEXT } from "./format.js";
import { estimate, issuedAnswerWithDiff, priceChangeList, refusedEstimate, replay, replayComparison, statement, statementAnswer } from "./increment3-fixtures.js";
import { toPriceChangesViewModel } from "./price-changes.js";
import { toReplayViewModel } from "./replay.js";
import type { ReplayCompareViewModel, ReplayDetailViewModel } from "./replay.js";
import { toStatementViewModel } from "./statement.js";

// Invariants of docs/plans/mcp-apps.md §4.5 for U12 to U15: the "Simulated",
// "inferred" and "estimate" labels are always there; a null figure reads
// "Unknown", never 0; AI Credits come before USD.

const amount = fc.double({ min: 0, max: 1_000_000, noNaN: true });
const nullableAmount = fc.option(amount, { nil: null });
const currency = fc.constantFrom<Currency>("AI_CREDITS", "USD");
const total = (value: number | null) => ({ value, knownTurns: value === null ? 0 : 1, turns: 1 });

function asReplay(vm: ReturnType<typeof toReplayViewModel>): ReplayDetailViewModel {
  if (vm.mode !== "replay") throw new Error("expected replay mode");
  return vm;
}

function asCompare(vm: ReturnType<typeof toReplayViewModel>): ReplayCompareViewModel {
  if (vm.mode !== "compare") throw new Error("expected compare mode");
  return vm;
}

describe("U12: replay figures are always Simulated", () => {
  it("labels every simulated figure Simulated and every measured one Measured, known or not", () => {
    fc.assert(
      fc.property(nullableAmount, nullableAmount, nullableAmount, currency, (measured, simulated, difference, unit) => {
        const base = replay();
        const vm = asReplay(
          toReplayViewModel({
            ...base,
            currency: unit,
            totals: { measured: total(measured), simulated: total(simulated), difference },
            turns: base.turns.map((turn) => ({ ...turn, measured: { ...turn.measured, cost: measured === null ? { known: false as const, reason: "r" } : turn.measured.cost } })),
          }),
        );
        expect(vm.label).toBe("Simulated");
        expect(vm.simulated.label).toBe("Simulated");
        expect(vm.difference.label).toBe("Simulated");
        expect(vm.measured.label).toBe("Measured");
        for (const turn of vm.turns) {
          expect(turn.simulated.label).toBe("Simulated");
          expect(turn.measured.label).toBe("Measured");
        }
      }),
    );
  });

  it("reads Unknown exactly for null figures, never 0", () => {
    fc.assert(
      fc.property(nullableAmount, nullableAmount, currency, (measured, simulated, unit) => {
        const difference = measured === null || simulated === null ? null : simulated - measured;
        const vm = asReplay(toReplayViewModel({ ...replay(), currency: unit, totals: { measured: total(measured), simulated: total(simulated), difference } }));
        for (const [figure, source] of [[vm.measured, measured], [vm.simulated, simulated], [vm.difference, difference]] as const) {
          expect(figure.text === UNKNOWN_TEXT).toBe(source === null);
          expect(figure.known).toBe(source !== null);
          expect(figure.amount).toBe(source);
        }
      }),
    );
  });

  it("calls out every self-check that did not pass", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 50 }).chain((requests) => fc.tuple(fc.constant(requests), fc.integer({ min: 0, max: requests }))), fc.boolean(), ([requests, matching], missing) => {
        const selfCheck = missing ? null : { model: "m", requests, matching, readTolerancePercent: 5, passed: matching === requests };
        const vm = asReplay(toReplayViewModel({ ...replay(), selfCheck }));
        expect(vm.selfCheck.callout).toBe(selfCheck === null || !selfCheck.passed);
        expect(vm.selfCheck.status).toBe(selfCheck === null ? "missing" : selfCheck.passed ? "passed" : "failed");
      }),
    );
  });

  it("labels every compared model Simulated and reads Unknown only for null", () => {
    fc.assert(
      fc.property(fc.array(nullableAmount, { minLength: 1, maxLength: 10 }), nullableAmount, currency, (values, measured, unit) => {
        const base = replayComparison();
        const vm = asCompare(
          toReplayViewModel({
            ...base,
            currency: unit,
            measured: total(measured),
            entries: values.map((value, index) => ({ model: `m${index}`, vendorId: "v", total: total(value), replayedTurns: 1, isMeasuredModel: index === 0 })),
          }),
        );
        expect(vm.label).toBe("Simulated");
        expect(vm.entries).toHaveLength(values.length);
        vm.entries.forEach((entry, index) => {
          expect(entry.total.label).toBe("Simulated");
          expect(entry.total.text === UNKNOWN_TEXT).toBe(values[index] === null);
        });
        expect(vm.measured.text === UNKNOWN_TEXT).toBe(measured === null);
      }),
    );
  });
});

describe("U13: observed price changes are always inferred", () => {
  const observed = fc.record({
    percent: fc.double({ min: -5, max: 5, noNaN: true }),
    direction: fc.constantFrom("above" as const, "below" as const),
    weeks: fc.integer({ min: 2, max: 8 }),
  });

  it("marks every observed change inferred and no documented change inferred", () => {
    fc.assert(
      fc.property(fc.array(observed, { maxLength: 6 }), (items) => {
        const list = priceChangeList();
        const documented = list.changes.filter((change) => change.kind === "documented");
        const template = list.changes.find((change) => change.kind === "observed")!;
        const changes = [
          ...documented,
          ...items.map((item) => (template.kind === "observed" ? { ...template, percent: item.percent, direction: item.direction, weeks: Array.from({ length: item.weeks }, () => template.weeks[0]!) } : template)),
        ];
        const vm = toPriceChangesViewModel({ ...list, changes });
        expect(vm.observed).toHaveLength(items.length);
        expect(vm.documented).toHaveLength(documented.length);
        for (const change of vm.observed) {
          expect(change.inferred).toBe(true);
          expect(change.label).toBe("inferred");
        }
        for (const change of vm.documented) expect(change.inferred).toBe(false);
        expect(vm.empty).toBe(changes.length === 0);
      }),
    );
  });
});

describe("U14: statements", () => {
  it("lists AI Credits before USD, whatever order the statement has", () => {
    fc.assert(
      fc.property(fc.array(currency, { minLength: 1, maxLength: 8 }), fc.array(currency, { minLength: 1, maxLength: 4 }), (lineCurrencies, totalCurrencies) => {
        const base = statement();
        const template = base.lines[1]!;
        const vm = toStatementViewModel(
          statementAnswer({
            statement: {
              ...base,
              lines: lineCurrencies.map((unit, index) => ({ ...template, key: `k${index}`, currency: unit })),
              totals: [...new Set(totalCurrencies)].map((unit) => ({ currency: unit, lines: 1, markup: 0, fixed: 0, total: 1 })),
            },
          }),
        );
        const rank = (unit: Currency) => (unit === "AI_CREDITS" ? 0 : 1);
        for (const list of [vm.lines.map((line) => line.currency), vm.totals.map((row) => row.currency)]) {
          expect(list.map(rank)).toEqual([...list.map(rank)].sort((a, b) => a - b));
        }
        expect(vm.lines).toHaveLength(lineCurrencies.length);
      }),
    );
  });

  it("reads Unknown for every null token count and every unknown group, never 0", () => {
    const tokens = fc.option(fc.integer({ min: 0, max: 1e9 }), { nil: null });
    fc.assert(
      fc.property(tokens, tokens, tokens, tokens, tokens, (uncachedInput, cacheRead, cacheWrite, reasoning, output) => {
        const base = statement();
        const vm = toStatementViewModel(statementAnswer({ statement: { ...base, lines: [{ ...base.lines[0]!, tokens: { uncachedInput, cacheRead, cacheWrite, reasoning, output } }] } }));
        const view = vm.lines[0]!.tokens;
        expect(view.uncachedInput.text === UNKNOWN_TEXT).toBe(uncachedInput === null);
        expect(view.cacheRead.text === UNKNOWN_TEXT).toBe(cacheRead === null);
        expect(view.cacheWrite.text === UNKNOWN_TEXT).toBe(cacheWrite === null);
        expect(view.reasoning.text === UNKNOWN_TEXT).toBe(reasoning === null);
        expect(view.output.text === UNKNOWN_TEXT).toBe(output === null);
        for (const group of vm.unknown) expect(group.amountText).toBe(UNKNOWN_TEXT);
      }),
    );
  });

  it("never reads an added or removed diff line as 'from 0'", () => {
    fc.assert(
      fc.property(amount, (value) => {
        const answer = issuedAnswerWithDiff();
        const diff = answer.diff!;
        const lines = [
          { key: "billed|AI_CREDITS|c|m|", change: "added" as const, issued: null, current: value, difference: value },
          { key: "billed|AI_CREDITS|c|n|", change: "removed" as const, issued: value, current: null, difference: -value },
        ];
        const vm = toStatementViewModel({ ...answer, diff: { ...diff, lines } });
        expect(vm.diff!.lines[0]!.issuedText).toBe("no earlier figure");
        expect(vm.diff!.lines[1]!.currentText).toBe("not in the re-run");
      }),
    );
  });
});

describe("U15: estimates are always labelled estimate", () => {
  it("carries the estimate label with a range or a refusal, and Unknown (never 0) for a missing range", () => {
    fc.assert(
      fc.property(amount, amount, fc.boolean(), fc.option(amount, { nil: null }), (a, b, refuse, perDay) => {
        const [p50, p90] = a <= b ? [a, b] : [b, a];
        const base = refuse ? refusedEstimate() : estimate();
        const vm = toEstimateViewModel({ ...base, ...(refuse ? {} : { range: { p50, p90 }, unitCost: { p50, p90 } }), runRate: { perActiveDayUsd: perDay, perWeekUsd: 1 } });
        expect(vm.label).toBe("estimate");
        expect(vm.refused).toBe(refuse);
        expect(vm.refusal !== undefined).toBe(refuse);
        if (refuse) {
          expect(vm.rangeText).toBe(UNKNOWN_TEXT);
          expect(vm.p50Text).toBe(UNKNOWN_TEXT);
          expect(vm.unitCostText).toBe(UNKNOWN_TEXT);
        } else {
          expect(vm.rangeText).toContain(vm.p50Text);
          expect(vm.rangeText).toContain(vm.p90Text);
        }
        expect(vm.sample.runRateText.startsWith(UNKNOWN_TEXT)).toBe(perDay === null);
      }),
    );
  });
});
