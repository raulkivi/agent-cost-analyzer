// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Manual check 1.8, "charts still distinguishable": judges the data marks a
// probe found in the page's charts. Pure: the browser reports paints, cues
// and labels, Node decides.
//
// The rule (docs/plans/vscode-ui-automation.md §6.9):
// 1. Every mark (bar, line, marker, legend swatch, hatching that carries
//    meaning) reaches 3:1 against the ground it is painted on (WCAG 1.4.11
//    non-text contrast). Translucent paints are composited first.
// 2. Each pair of neighbouring series in a chart (order of first appearance)
//    is told apart by ONE of: their paints are 3:1 apart; or their cues
//    differ (stroke dash pattern, fill pattern: the colour is then not the
//    only means); or both carry their own direct label in the chart. A
//    legend alone does not count: it makes the reader match colours.
import { compositeOver, contrastRatio, groundOf, parseCssColor, type Rgba } from "./contrast.mts";

export const MARK_CONTRAST = 3;

export type MarkKind = "bar" | "line" | "marker" | "swatch" | "hatch";

export interface ProbedMark {
  // The chart's accessible name.
  chart: string;
  // Which series the mark belongs to; "" for a chart with one.
  series: string;
  kind: MarkKind;
  // Computed fill (bars, markers, swatches) or stroke (lines, hatch lines).
  paint: string;
  // Background colours from the mark's element outwards to <html>.
  backgrounds: string[];
  // A non-colour cue: the dash pattern, or "pattern" for a hatch; "" if none.
  cue: string;
  // The series has its own text label drawn in the chart.
  labelled: boolean;
}

function visiblePaint(mark: ProbedMark, ground: Rgba): Rgba | null {
  const paint = parseCssColor(mark.paint);
  return paint && paint.a > 0 ? compositeOver(paint, ground) : null;
}

function judgeEachMark(marks: ProbedMark[]): string[] {
  const findings = new Set<string>();
  for (const mark of marks) {
    const ground = groundOf(mark.backgrounds);
    const paint = visiblePaint(mark, ground);
    if (!paint) continue;
    const ratio = contrastRatio(paint, ground);
    if (ratio >= MARK_CONTRAST) continue;
    const series = mark.series ? ` ${mark.series}` : "";
    findings.add(`chart mark contrast ${ratio.toFixed(1)}:1 < ${MARK_CONTRAST}: ${mark.chart}${series} (${mark.kind})`);
  }
  return [...findings];
}

function firstMarkPerSeries(marks: ProbedMark[]): Map<string, ProbedMark[]> {
  const perChart = new Map<string, Map<string, ProbedMark>>();
  for (const mark of marks) {
    if (mark.series === "") continue;
    const series = perChart.get(mark.chart) ?? new Map<string, ProbedMark>();
    if (!series.has(mark.series)) series.set(mark.series, mark);
    perChart.set(mark.chart, series);
  }
  return new Map([...perChart].map(([chart, series]) => [chart, [...series.values()]]));
}

function judgeNeighbours(marks: ProbedMark[]): string[] {
  const findings: string[] = [];
  for (const [chart, series] of firstMarkPerSeries(marks)) {
    for (let index = 1; index < series.length; index++) {
      const [left, right] = [series[index - 1]!, series[index]!];
      const ground = groundOf(right.backgrounds);
      const [a, b] = [visiblePaint(left, ground), visiblePaint(right, ground)];
      if (!a || !b) continue;
      const apart = contrastRatio(a, b);
      if (apart >= MARK_CONTRAST) continue;
      if (left.cue !== right.cue) continue;
      if (left.labelled && right.labelled) continue;
      findings.push(
        `series not distinguishable: ${chart} ${left.series} / ${right.series} (colours ${apart.toFixed(1)}:1 apart; no different dash or pattern, no direct label on both)`,
      );
    }
  }
  return findings;
}

export function judgeChartMarks(marks: ProbedMark[]): string[] {
  return [...judgeEachMark(marks), ...judgeNeighbours(marks)];
}
