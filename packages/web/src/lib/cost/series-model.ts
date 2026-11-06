import { repositoryFolderLabel, type CostSeries, type CostSeriesLine, type Currency, type PriceChangeMarker } from "@agent-cost-analyzer/domain";
import { amountIn, formatChange, type DisplayUnit } from "./cost-format.js";
import { keepLine, type SeriesScope } from "./cost-scope.js";
import type { DateRange } from "./date-ranges.js";
import type { SeriesPalette, SeriesStyle } from "./series-colors.js";

// Phase 15 step 15.9 (plan §11.2, §11.3): a GET /api/cost/timeseries answer
// as what the charts draw. Pure functions, so the rules (a bucket with turns
// but nothing known is a gap, never 0; an idle bucket is 0; a partial total
// carries its coverage) are tested here, not in the SVG.

export interface ChartPoint {
  period: string;
  start: string;
  end: string;
  // null: the bucket had turns but no known cost (drawn as a gap).
  value: number | null;
  turns: number;
  knownTurns: number;
  // Some, not all, of its turns have a known cost.
  partial: boolean;
}

export interface ChartLine {
  key: string | null;
  label: string;
  style: SeriesStyle;
  points: ChartPoint[];
  total: number | null;
  coverage: { turns: number; knownTurns: number };
  currencies: Currency[];
}

interface LineOptions {
  palette: SeriesPalette;
  unit: DisplayUnit;
  scope?: Pick<SeriesScope, "groupBy" | "keep">;
}

function lineLabel(line: CostSeriesLine, groupBy: CostSeries["groupBy"]): string {
  return groupBy === "repository" && line.key !== null ? repositoryFolderLabel(line.label) : line.label;
}

function toLine(line: CostSeriesLine, groupBy: CostSeries["groupBy"], { palette, unit }: LineOptions): ChartLine {
  return {
    key: line.key,
    label: lineLabel(line, groupBy),
    style: palette.styleFor(line.key),
    points: line.points.map((point) => ({
      period: point.period,
      start: point.start,
      end: point.end,
      value: point.turns === 0 ? 0 : amountIn(point.cost, unit),
      turns: point.turns,
      knownTurns: point.cost.knownTurns,
      partial: point.cost.knownTurns > 0 && point.cost.knownTurns < point.turns,
    })),
    total: line.total.turns === 0 ? 0 : amountIn(line.total, unit),
    coverage: { turns: line.total.turns, knownTurns: line.total.knownTurns },
    currencies: line.total.amounts.map((amount) => amount.currency),
  };
}

export function chartLines(series: CostSeries, options: LineOptions): ChartLine[] {
  const scope = options.scope;
  return series.series.filter((line) => !scope || keepLine(scope, line.key)).map((line) => toLine(line, series.groupBy, options));
}

export function nativeCurrencies(lines: readonly ChartLine[]): Currency[] {
  const present = new Set(lines.flatMap((line) => line.currencies));
  return (["AI_CREDITS", "USD"] as const).filter((currency) => present.has(currency));
}

const sumKnown = (values: (number | null)[]): number | null =>
  values.some((value) => value !== null) ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null;

export interface CostKpis {
  total: number | null;
  coverage: { turns: number; knownTurns: number };
  previous: number | null;
  change: number | null;
  activeDays: number | null;
  perActiveDay: number | null;
}

// `summary`: the same scope day by day from the start of the previous
// period to the end of this one, for the change and the active days; absent
// until it loads (both stay unknown).
export function costKpis(lines: readonly ChartLine[], summary: CostSeries | undefined, range: DateRange, options: LineOptions): CostKpis {
  const coverage = lines.reduce((sum, line) => ({ turns: sum.turns + line.coverage.turns, knownTurns: sum.knownTurns + line.coverage.knownTurns }), { turns: 0, knownTurns: 0 });
  const total = coverage.turns === 0 ? 0 : sumKnown(lines.map((line) => line.total));
  if (!summary) return { total, coverage, previous: null, change: null, activeDays: null, perActiveDay: null };
  const keys = new Set(lines.map((line) => line.key));
  const days = chartLines(summary, options).filter((line) => keys.has(line.key)).flatMap((line) => line.points);
  const previousDays = days.filter((point) => point.end < range.since && point.turns > 0);
  const previous = sumKnown(previousDays.map((point) => point.value));
  const activeDays = new Set(days.filter((point) => point.start >= range.since && point.start <= range.until && point.turns > 0).map((point) => point.period)).size;
  const change = total === null || previous === null || previous === 0 ? null : (total - previous) / previous;
  const perActiveDay = total === null || activeDays === 0 ? null : total / activeDays;
  return { total, coverage, previous, change, activeDays, perActiveDay };
}

// The running total of the known amounts, as its own small chart (never a
// second axis): a gap adds nothing and the line holds level.
export function runningTotalLine(line: ChartLine): ChartLine {
  let running = 0;
  return {
    ...line,
    points: line.points.map((point) => {
      running += point.value ?? 0;
      return { ...point, value: running, partial: false };
    }),
  };
}

// §8.2: each line indexed to its first bucket with a known, non-zero cost
// (= 100), so a large and a small project share one axis.
export function indexedLines(lines: readonly ChartLine[]): ChartLine[] {
  return lines.map((line) => {
    const baseIndex = line.points.findIndex((point) => point.value !== null && point.value > 0);
    const base = baseIndex === -1 ? null : line.points[baseIndex]!.value!;
    return {
      ...line,
      // Before its base bucket a line has nothing to index, so it starts there.
      points: line.points.map((point, index) => ({
        ...point,
        value: base === null || point.value === null || index < baseIndex ? null : (point.value / base) * 100,
      })),
    };
  });
}

export interface PriceMarkerGroup {
  date: string;
  modelId: string;
  label: string;
  markers: PriceChangeMarker[];
}

function percentLabel(markers: readonly PriceChangeMarker[]): string {
  const percents = new Set(markers.flatMap((marker) => marker.changes.map((change) => change.percent)));
  if (percents.size !== 1) return "changed";
  const [percent] = [...percents];
  return percent === null || percent === undefined ? "changed" : formatChange(percent / 100).replace(".0%", "%");
}

// One tag per model and date: the same change on two channels (Copilot and
// the vendor's API) is one marker with both in its tooltip.
export function groupPriceMarkers(markers: readonly PriceChangeMarker[]): PriceMarkerGroup[] {
  const groups = new Map<string, PriceChangeMarker[]>();
  for (const marker of markers) {
    const key = `${marker.date} ${marker.modelId}`;
    groups.set(key, [...(groups.get(key) ?? []), marker]);
  }
  return [...groups.values()]
    .map((group) => ({ date: group[0]!.date, modelId: group[0]!.modelId, markers: group, label: `Price · ${group[0]!.modelId} ${percentLabel(group)}` }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.modelId.localeCompare(b.modelId));
}
