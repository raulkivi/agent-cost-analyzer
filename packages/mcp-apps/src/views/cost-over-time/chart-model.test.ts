// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { basisTotals, costSeries, costTotal, point, usdTotal } from "../../view-models/cost-analysis-fixtures.js";
import { toCostSeriesViewModel } from "../../view-models/index.js";
import { AXIS_FONT_MAX, AXIS_LABEL_GAP, buildChart } from "./chart-model.js";

const week = (start: string, end: string, period: string, total: ReturnType<typeof costTotal>) => point(period, start, end, total, total);

function vmOf(points: ReturnType<typeof point>[], overrides = {}) {
  return toCostSeriesViewModel(costSeries({ bucket: "week", points, ...overrides }));
}

describe("buildChart bars", () => {
  const vm = vmOf([
    week("2026-08-03", "2026-08-09", "2026-W32", costTotal(26.2, 18, 18)),
    week("2026-08-10", "2026-08-16", "2026-W33", costTotal(null, 0, 0)),
    week("2026-08-17", "2026-08-23", "2026-W34", costTotal(21.8, 11, 18)),
    week("2026-08-24", "2026-08-30", "2026-W35", costTotal(null, 0, 7)),
  ]);
  const chart = buildChart(vm.chart.points, "AI_CREDITS", vm.markers);

  it("draws a fully known week as a bar with its value", () => {
    expect(chart.bars[0]).toMatchObject({ state: "known", value: 26.2, label: "Aug 3" });
    expect(chart.bars[0]?.title).toBe("Aug 3: 26.20 AI Credits");
  });

  it("reads a week with no turns as '0 turns', not a bar and not a gap", () => {
    expect(chart.bars[1]).toMatchObject({ state: "empty", value: null });
    expect(chart.bars[1]?.title).toBe("Aug 10: 0 turns");
  });

  it("draws a partly known week as a floor with its coverage", () => {
    expect(chart.bars[2]).toMatchObject({ state: "partial", value: 21.8 });
    expect(chart.bars[2]?.title).toBe("Aug 17: 21.80 AI Credits, known for 11 of 18 turns");
  });

  it("draws a week with turns but nothing known as an Unknown gap, never 0", () => {
    expect(chart.bars[3]).toMatchObject({ state: "gap", value: null });
    expect(chart.bars[3]?.title).toBe("Aug 24: Unknown");
  });

  it("scales to the largest known value", () => {
    expect(chart.max).toBe(26.2);
  });
});

describe("buildChart currency", () => {
  const mixed = { ...costTotal(10, 5, 5), amounts: [{ currency: "AI_CREDITS" as const, amount: 10, knownTurns: 5 }, { currency: "USD" as const, amount: 4, knownTurns: 5 }] };
  const usdOnly = usdTotal(3, 4, 4);
  const vm = vmOf([week("2026-08-03", "2026-08-09", "2026-W32", mixed), week("2026-08-10", "2026-08-16", "2026-W33", usdOnly)], { total: mixed, totals: basisTotals({ preferred: mixed }) });

  it("lists the currencies in the points", () => {
    expect(vm.chart.currencies).toEqual(["AI_CREDITS", "USD"]);
  });

  it("charts the chosen currency; a week with no figure in it is a gap that says so", () => {
    const credits = buildChart(vm.chart.points, "AI_CREDITS", vm.markers);
    expect(credits.bars.map((bar) => bar.state)).toEqual(["known", "gap"]);
    expect(credits.bars[1]?.title).toBe("Aug 10: no AI Credits figure");
    const usd = buildChart(vm.chart.points, "USD", vm.markers);
    expect(usd.bars.map((bar) => bar.value)).toEqual([4, 3]);
    expect(usd.bars[0]?.title).toBe("Aug 3: $4.00");
  });

  it("is all gaps with no max when no currency is known", () => {
    const none = vmOf([week("2026-08-03", "2026-08-09", "2026-W32", costTotal(null, 0, 3))]);
    const chart = buildChart(none.chart.points, null, none.markers);
    expect(chart.bars[0]).toMatchObject({ state: "gap", value: null });
    expect(chart.bars[0]?.title).toBe("Aug 3: Unknown");
    expect(chart.max).toBeNull();
  });
});

describe("buildChart markers", () => {
  const vm = vmOf([
    week("2026-10-12", "2026-10-18", "2026-W42", costTotal(10, 5, 5)),
    week("2026-10-19", "2026-10-25", "2026-W43", costTotal(12, 5, 5)),
    week("2026-10-26", "2026-11-01", "2026-W44", costTotal(14, 5, 5)),
  ]);
  const chart = buildChart(vm.chart.points, "AI_CREDITS", vm.markers);

  it("places a documented change inside its bucket by date", () => {
    const documented = chart.markers.find((marker) => marker.kind === "documented");
    expect(documented).toMatchObject({ inferred: false });
    // 2026-10-15 is the 4th day of the 7-day first bucket: index 0 + 3.5/7.
    expect(documented?.position).toBeCloseTo(0.5, 5);
    expect(documented?.title).toBe("Oct 15: claude-sonnet-5.5 input +33.33 %, cache write none to $5.00 / 1M (documented)");
  });

  it("marks an observed change as inferred, from the start of its bucket", () => {
    const observed = chart.markers.find((marker) => marker.kind === "observed");
    expect(observed).toMatchObject({ inferred: true, position: 2 });
    expect(observed?.title).toBe("From the week of Oct 26: gpt-6.1-sol billed 12 % above the price book, 2 weeks in a row (inferred)");
  });

  // A23 visual review: on a monthly chart the observed change from the week
  // of Oct 26 sat at Oct 1, the month's left edge.
  it("places an observed change at the start of its week inside a longer bucket", () => {
    const monthly = toCostSeriesViewModel(costSeries());
    const observed = buildChart(monthly.chart.points, "AI_CREDITS", monthly.markers).markers.find((marker) => marker.kind === "observed");
    // 2026-10-26 starts the 26th day of the 31-day October bucket: 25/31.
    expect(observed?.position).toBeCloseTo(25 / 31, 5);
  });

  it("leaves a change outside every bucket out of the chart", () => {
    const outside = vmOf([week("2026-01-05", "2026-01-11", "2026-W02", costTotal(10, 5, 5))]);
    expect(buildChart(outside.chart.points, "AI_CREDITS", outside.markers).markers).toEqual([]);
  });
});

describe("buildChart left inset", () => {
  const inset = (amount: number) => buildChart(vmOf([week("2026-08-03", "2026-08-09", "2026-W32", costTotal(amount, 1, 1))]).chart.points, "AI_CREDITS", []).leftInset;
  // Axis text is CSS-sized from 10 to 18 viewBox units on a narrow host, about 0.6 em per glyph.
  const widest = (chars: number) => chars * 0.6 * AXIS_FONT_MAX;

  it("leaves room for the widest axis label at the largest label size, plus the gap to the axis and the edge", () => {
    for (const [amount, label] of [[26.2, "26.2"], [12_345, "12K"], [1234.5, "1235"], [0.043, "0.043"]] as const) {
      expect(inset(amount)).toBeGreaterThanOrEqual(widest(label.length) + AXIS_LABEL_GAP);
    }
  });

  it("grows with the label and never shrinks below the default plot margin", () => {
    expect(inset(0.043)).toBeGreaterThan(inset(2));
    expect(inset(2)).toBeGreaterThanOrEqual(36);
  });

  it("uses the default margin when no bucket has a figure", () => {
    expect(buildChart([], "USD", []).leftInset).toBe(36);
  });
});
