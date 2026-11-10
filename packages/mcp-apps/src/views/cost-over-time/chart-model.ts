// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Currency } from "@agent-cost-analyzer/domain";
import { formatTick } from "@agent-cost-analyzer/web/lib/cost/cost-format";
import type { PointView, PriceMarker } from "../../view-models/index.js";

// What the U9 chart draws, decided apart from the SVG so the rules are
// testable: a bar for a known bucket, a floor (bar plus hatched cap) for a
// partly known one, a hatched gap for a bucket with turns and no figure, and
// the words "0 turns" for an idle one. Never a zero bar for an unknown
// (constraint 6). Pure.

export type BarState = "known" | "partial" | "gap" | "empty";

export interface ChartBar {
  period: string;
  label: string;
  state: BarState;
  value: number | null;
  title: string;
}

export interface ChartMarker {
  kind: "documented" | "observed";
  inferred: boolean;
  // Along the buckets: 0 is the left edge of the first, 1 the right edge of it.
  position: number;
  title: string;
}

export interface ChartModel {
  unitLabel: string;
  bars: ChartBar[];
  max: number | null;
  // Viewbox units left of the plot: the widest y-axis label, a gap to the axis and the edge.
  leftInset: number;
  markers: ChartMarker[];
}

// The axis text is sized by CSS from 10 up to 18 viewBox units (narrow hosts
// scale it up so it stays readable), and a glyph is about 0.6 em wide, so the
// inset is worked out for the largest size: the label then never leaves the
// chart on the left or reaches a price-change marker at the first bucket.
export const AXIS_FONT_MAX = 18;
// Label to plot edge (clear of a diamond at the first bucket, 5 wide) plus label to chart edge.
export const AXIS_TO_PLOT = 8;
export const AXIS_LABEL_GAP = AXIS_TO_PLOT + 4;
const GLYPH_EM = 0.6;
const DEFAULT_INSET = 36;

export function leftInsetFor(labels: readonly string[]): number {
  const widest = Math.max(0, ...labels.map((label) => label.length));
  return Math.max(DEFAULT_INSET, Math.ceil(widest * GLYPH_EM * AXIS_FONT_MAX) + AXIS_LABEL_GAP);
}

const UNIT_LABEL: Record<Currency, string> = { AI_CREDITS: "AI Credits", USD: "USD" };

export function unitLabelOf(currency: Currency | null): string {
  return currency === null ? "Unknown" : UNIT_LABEL[currency];
}

function bar(point: PointView, currency: Currency | null): ChartBar {
  const base = { period: point.period, label: point.label };
  if (point.turns === 0) return { ...base, state: "empty", value: null, title: `${point.label}: 0 turns` };
  const money = currency === null ? undefined : point.cost.find((view) => view.known && view.currency === currency);
  if (money?.amount === null || money === undefined) {
    // Known in another currency only: say which figure is missing.
    const otherCurrency = currency !== null && point.cost.some((view) => view.known);
    return { ...base, state: "gap", value: null, title: `${point.label}: ${otherCurrency ? `no ${unitLabelOf(currency)} figure` : "Unknown"}` };
  }
  const partial = money.coverageNote !== undefined;
  return { ...base, state: partial ? "partial" : "known", value: money.amount, title: `${point.label}: ${money.text}${partial ? `, ${money.coverageNote}` : ""}` };
}

const DAY_MS = 86_400_000;

function positionOf(marker: PriceMarker, points: readonly PointView[]): number | undefined {
  const index = points.findIndex((point) => point.period === marker.period);
  const point = points[index];
  if (point === undefined) return undefined;
  if (marker.kind === "observed") return index;
  const days = (Date.parse(point.end) - Date.parse(point.start)) / DAY_MS + 1;
  const offset = (Date.parse(marker.date) - Date.parse(point.start)) / DAY_MS;
  return index + Math.min(1, Math.max(0, (offset + 0.5) / days));
}

// "input +33.33 %, cache write none to $5.00 / 1M": the percent where both
// prices exist, else the two prices.
export function describeDocumented(marker: Extract<PriceMarker, { kind: "documented" }>): string {
  return marker.lines.map((line) => (line.percentText === undefined ? `${line.tokenText} ${line.fromText} to ${line.toText}` : `${line.tokenText} ${line.percentText}`)).join(", ");
}

export function describeObserved(marker: Extract<PriceMarker, { kind: "observed" }>): string {
  return `billed ${marker.percentText.replace(/^[+−]/, "")} ${marker.direction} the price book, ${marker.weeksText}`;
}

function markerTitle(marker: PriceMarker): string {
  return marker.kind === "documented"
    ? `${marker.dateText}: ${marker.modelId} ${describeDocumented(marker)} (documented)`
    : `From the week of ${marker.dateText}: ${marker.modelId} ${describeObserved(marker)} (inferred)`;
}

export function buildChart(points: readonly PointView[], currency: Currency | null, markers: readonly PriceMarker[]): ChartModel {
  const bars = points.map((point) => bar(point, currency));
  const known = bars.flatMap((entry) => (entry.value === null ? [] : [entry.value]));
  const max = known.length === 0 ? null : Math.max(...known);
  return {
    unitLabel: unitLabelOf(currency),
    bars,
    max,
    leftInset: leftInsetFor(max === null ? [] : [formatTick(0, currency ?? "AI_CREDITS"), formatTick(max, currency ?? "AI_CREDITS")]),
    markers: markers.flatMap((marker): ChartMarker[] => {
      const position = positionOf(marker, points);
      return position === undefined ? [] : [{ kind: marker.kind, inferred: marker.inferred, position, title: markerTitle(marker) }];
    }),
  };
}
