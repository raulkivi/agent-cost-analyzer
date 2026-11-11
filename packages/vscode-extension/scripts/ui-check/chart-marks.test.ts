// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { judgeChartMarks, type ProbedMark } from "./chart-marks.mts";
import { judgeProbe, type Probe } from "./judge.mts";

const dark = "rgb(31, 31, 31)";
const light = "rgb(255, 255, 255)";
const blue = "rgb(57, 135, 229)";
const orange = "rgb(217, 89, 38)";
const closeToBlue = "rgb(70, 140, 225)";

function mark(overrides: Partial<ProbedMark> = {}): ProbedMark {
  return { chart: "Cost over time", series: "a", kind: "line", paint: blue, backgrounds: ["rgba(0, 0, 0, 0)", dark], cue: "", labelled: false, ...overrides };
}

describe("judgeChartMarks: each mark against its ground (WCAG 1.4.11)", () => {
  it("passes a mark at 3:1 or more", () => {
    expect(judgeChartMarks([mark()])).toEqual([]);
  });

  it("reports a mark under 3:1 with its chart, series and kind", () => {
    const findings = judgeChartMarks([mark({ paint: "rgb(50, 50, 50)", series: "errors", kind: "bar" })]);
    expect(findings).toEqual(["chart mark contrast 1.3:1 < 3: Cost over time errors (bar)"]);
  });

  it("composites a translucent mark over its ground first", () => {
    expect(judgeChartMarks([mark({ paint: "rgba(57, 135, 229, 0.1)" })])).toHaveLength(1);
  });

  it("judges the ground a mark is on, not the page's", () => {
    expect(judgeChartMarks([mark({ paint: "rgb(140, 180, 240)", backgrounds: [light] })])).toHaveLength(1);
  });

  it("skips a mark whose paint is none or can't be parsed", () => {
    expect(judgeChartMarks([mark({ paint: "none" }), mark({ paint: "var(--x)" })])).toEqual([]);
  });

  it("reports each failing mark once", () => {
    const bad = mark({ paint: "rgb(50, 50, 50)" });
    expect(judgeChartMarks([bad, bad])).toHaveLength(1);
  });
});

describe("judgeChartMarks: adjacent series distinguishable", () => {
  const first = mark({ series: "a", paint: blue });

  it("accepts two series whose colours are 3:1 apart", () => {
    expect(judgeChartMarks([first, mark({ series: "b", paint: "rgb(255, 255, 255)" })])).toEqual([]);
  });

  it("rejects two series of similar colour with no other cue", () => {
    expect(judgeChartMarks([first, mark({ series: "b", paint: closeToBlue })])).toEqual([
      "series not distinguishable: Cost over time a / b (colours 1.1:1 apart; no different dash or pattern, no direct label on both)",
    ]);
  });

  it("accepts similar colours when the dash or pattern differs", () => {
    expect(judgeChartMarks([first, mark({ series: "b", paint: closeToBlue, cue: "7 4" })])).toEqual([]);
  });

  it("rejects two series that carry the same cue", () => {
    const a = mark({ series: "a", cue: "7 4" });
    const b = mark({ series: "b", paint: closeToBlue, cue: "7 4" });
    expect(judgeChartMarks([a, b])).toHaveLength(1);
  });

  it("accepts similar colours when both series have their own direct label", () => {
    const a = mark({ series: "a", labelled: true });
    const b = mark({ series: "b", paint: closeToBlue, labelled: true });
    expect(judgeChartMarks([a, b])).toEqual([]);
  });

  it("does not accept a label on only one of the two", () => {
    const a = mark({ series: "a", labelled: true });
    const b = mark({ series: "b", paint: closeToBlue });
    expect(judgeChartMarks([a, b])).toHaveLength(1);
  });

  it("compares neighbours in order of first appearance, per chart", () => {
    const a = mark({ series: "a" });
    const b = mark({ series: "b", paint: "rgb(255, 255, 255)" });
    const otherChart = mark({ chart: "Tool calls", series: "a", paint: closeToBlue });
    expect(judgeChartMarks([a, b, otherChart])).toEqual([]);
  });

  it("judges a series by its first mark; its other marks are not another series", () => {
    expect(judgeChartMarks([first, mark({ series: "a" }), mark({ series: "a", kind: "marker" })])).toEqual([]);
  });

  it("a single-series chart has no neighbour to confuse", () => {
    expect(judgeChartMarks([mark({ series: "" })])).toEqual([]);
  });

  it("blue and orange differ in hue but are not 3:1 apart on dark, so they need a cue", () => {
    expect(judgeChartMarks([first, mark({ series: "b", paint: orange })])).toHaveLength(1);
    expect(judgeChartMarks([first, mark({ series: "b", paint: orange, cue: "7 4" })])).toEqual([]);
  });
});

describe("judgeProbe with chart marks", () => {
  const base: Probe = { viewportWidth: 1000, scrollWidth: 1000, overflowing: [], texts: [] };

  it("adds the mark findings to the page's", () => {
    expect(judgeProbe({ ...base, marks: [mark({ paint: "rgb(50, 50, 50)" })] })).toHaveLength(1);
  });

  it("a probe without marks is judged as before", () => {
    expect(judgeProbe(base)).toEqual([]);
  });
});
