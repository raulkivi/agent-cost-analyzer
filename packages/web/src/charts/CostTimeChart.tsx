// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useId, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { scaleLinear } from "d3-scale";
import { channelLabel, type CostBucket, type PriceChangeMarker, type PriceTokenType } from "@agent-cost-analyzer/domain";
import { coverageNote, formatUnitPrice } from "../lib/cost/cost-format.js";
import { bucketLongLabel, longDate } from "../lib/cost/date-ranges.js";
import type { ChartLine, ChartPoint, PriceMarkerGroup } from "../lib/cost/series-model.js";
import { useContainerWidth } from "../lib/use-container-width.js";
import { ChartLegend, roundedTopRectPath } from "./chart-parts.js";
import type { ChartDataRow } from "./ChartDataTable.js";
import { ViewAsTable } from "./ViewAsTable.js";

// Phase 15 step 15.9 (plan §11.2, dataviz): cost per bucket over time. One
// series as columns, two to four as lines with a legend and a direct label
// at each line's end; small multiples reuse it compact. One y-axis only. A
// bucket with turns but no known cost is a gap with a visible "unknown"
// band, never a 0 (constraint 6); a partly covered column has a hatched cap.
// Documented price changes are a hairline plus a focusable tag whose tooltip
// gives the old and new unit prices and the source. The plot takes focus:
// arrows move a crosshair whose tooltip lists every series; "View as table"
// shows the same figures, price changes in rows of their own.

interface CostTimeChartProps {
  ariaLabel: string;
  lines: ChartLine[];
  bucket: CostBucket;
  format: (value: number) => string;
  formatTick: (value: number) => string;
  // The figures' unit, in the table's column headers ("AI Credits").
  unitLabel: string;
  mode?: "lines" | "columns";
  markers?: PriceMarkerGroup[];
  // A shared y-scale (small multiples' "Shared scale").
  yMax?: number;
  // A reference line (the indexed chart's 100).
  reference?: number;
  compact?: boolean;
  directLabels?: boolean;
  emptyText?: string;
}

const FALLBACK_WIDTH = 720;
const AXIS_WIDTH = 52;
const LABEL_WIDTH = 132;
const TAG_ROW_HEIGHT = 28;
const TAG_CHAR_WIDTH = 6.6;
const MAX_COLUMN = 24;
const MIN_LABEL_GAP = 16;

const TOKEN_TYPE_LABELS: Record<PriceTokenType, string> = {
  input: "Input",
  cachedInput: "Cached input",
  cacheWrite: "Cache write",
  extendedCacheWrite: "Extended cache write",
  output: "Output",
};

function percentText(percent: number | null): string {
  if (percent === null) return "";
  if (percent === 0) return "0%";
  return `${percent > 0 ? "+" : "−"}${Math.abs(percent)}%`;
}

function tokenTypeLabel(change: PriceChangeMarker["changes"][number]): string {
  const label = TOKEN_TYPE_LABELS[change.tokenType];
  return change.tier > 0 ? `${label} (tier ${change.tier + 1})` : label;
}

function channelsOf(group: PriceMarkerGroup): string {
  if (group.observed) return channelLabel(group.observed.channel);
  return [...new Set(group.markers.map((marker) => channelLabel(marker.channel)))].join(" and ");
}

// Step 15.10: an observed change's sentence (inferred, never a price).
function observedSentence(change: NonNullable<PriceMarkerGroup["observed"]>): string {
  return `billed ${Math.abs(change.percent)}% ${change.direction} the price book for ${change.weeks.length} weeks in a row`;
}

function changeSentence(group: PriceMarkerGroup): string {
  const first = group.markers[0]!;
  return first.changes
    .map((change) => {
      const direction = change.percent === null ? "" : `, ${Math.abs(change.percent)} percent ${change.percent < 0 ? "lower" : "higher"}`;
      return `${tokenTypeLabel(change).toLowerCase()} ${formatUnitPrice(change.fromUsdPerM)} to ${formatUnitPrice(change.toUsdPerM)} per million tokens${direction}`;
    })
    .join("; ");
}

// The marker's accessible name: the whole change, not only the tag's text.
export function priceMarkerDescription(group: PriceMarkerGroup): string {
  if (group.observed) {
    return `Observed on ${longDate(group.date)}: ${group.modelId} on ${channelsOf(group)} ${observedSentence(group.observed)}. Inferred, not documented: check the price book.`;
  }
  return `Price change on ${longDate(group.date)}: ${group.modelId} on ${channelsOf(group)}, ${changeSentence(group)}. Documented.`;
}

function segments(points: readonly ChartPoint[]): number[][] {
  const result: number[][] = [];
  let current: number[] = [];
  points.forEach((point, index) => {
    if (point.value === null) {
      if (current.length > 0) result.push(current);
      current = [];
    } else {
      current.push(index);
    }
  });
  if (current.length > 0) result.push(current);
  return result;
}

function lastKnown(points: readonly ChartPoint[]): number {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    if (points[index]!.value !== null) return index;
  }
  return -1;
}

// Tags left to right in as few rows as fit without overlapping.
function tagRows(groups: readonly { x: number; width: number }[]): number[] {
  const rowEnds: number[] = [];
  return groups.map((group) => {
    const row = rowEnds.findIndex((end) => end + 6 <= group.x);
    const chosen = row === -1 ? rowEnds.length : row;
    rowEnds[chosen] = group.x + group.width;
    return chosen;
  });
}

// Direct labels at each line's end, spread so they never overlap: pushed
// down where they crowd, then back up from the bottom if that overflows.
export function labelPositions(ys: readonly number[], top: number, bottom: number, gap = 2 * MIN_LABEL_GAP): number[] {
  const order = ys.map((y, index) => ({ y, index })).sort((a, b) => a.y - b.y);
  const placed = order.map((item) => Math.max(top, Math.min(bottom, item.y)));
  for (let index = 1; index < placed.length; index += 1) placed[index] = Math.max(placed[index]!, placed[index - 1]! + gap);
  for (let index = placed.length - 1; index >= 0; index -= 1) {
    const limit = index === placed.length - 1 ? bottom : placed[index + 1]! - gap;
    placed[index] = Math.min(placed[index]!, limit);
  }
  const result = new Array<number>(ys.length);
  order.forEach((item, position) => {
    result[item.index] = placed[position]!;
  });
  return result;
}

export function CostTimeChart({
  ariaLabel,
  lines,
  bucket,
  format,
  formatTick,
  unitLabel,
  mode = "lines",
  markers = [],
  yMax,
  reference,
  compact = false,
  directLabels,
  emptyText,
}: CostTimeChartProps) {
  const [measure, measuredWidth] = useContainerWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const [openMarker, setOpenMarker] = useState<number | null>(null);
  const baseId = useId();
  const points = lines[0]?.points ?? [];

  if (lines.length === 0 || points.length === 0) {
    return <p className="text-muted chart-empty">{emptyText ?? "No data."}</p>;
  }

  const width = Math.max(240, measuredWidth || FALLBACK_WIDTH);
  const columns = mode === "columns" && lines.length === 1;
  const showDirectLabels = (directLabels ?? (lines.length >= 2 && lines.length <= 4)) && !compact && width >= 480;
  const height = compact ? 120 : 240;
  const margin = { top: compact ? 10 : 20, right: showDirectLabels ? LABEL_WIDTH : 12, bottom: 22, left: compact ? 40 : AXIS_WIDTH };
  const plotWidth = Math.max(40, width - margin.left - margin.right);
  const plotBottom = height - margin.bottom;
  const step = plotWidth / points.length;
  const xOf = (index: number) => margin.left + (index + 0.5) * step;
  const values = lines.flatMap((line) => line.points.map((point) => point.value ?? 0));
  const max = Math.max(yMax ?? 0, reference ?? 0, ...values);
  const y = scaleLinear()
    .domain([0, max > 0 ? max : 1])
    .nice()
    .range([plotBottom, margin.top]);
  const ticks = y.ticks(compact ? 2 : 4);
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotWidth / (compact ? 70 : 64)))));
  const gapIndexes = points.map((_, index) => index).filter((index) => lines.some((line) => line.points[index]!.turns > 0 && line.points[index]!.value === null));

  const markerPositions = markers.map((group) => {
    const index = points.findIndex((point) => point.start <= group.date && group.date <= point.end);
    if (index === -1) return null;
    const point = points[index]!;
    const days = (Date.parse(point.end) - Date.parse(point.start)) / 86_400_000 + 1;
    const offset = (Date.parse(group.date) - Date.parse(point.start)) / 86_400_000;
    return margin.left + (index + (offset + 0.5) / days) * step;
  });
  const placedMarkers = markers.flatMap((group, index) => (markerPositions[index] === null ? [] : [{ group, index, x: markerPositions[index]! }]));
  const tagWidths = placedMarkers.map(({ group }) => group.label.length * TAG_CHAR_WIDTH + 18);
  const tagLefts = placedMarkers.map(({ x }, index) => Math.max(0, Math.min(width - tagWidths[index]!, x - 4)));
  const rows = tagRows(placedMarkers.map((_, index) => ({ x: tagLefts[index]!, width: tagWidths[index]! })));
  const tagAreaHeight = compact || placedMarkers.length === 0 ? 0 : (Math.max(...rows) + 1) * TAG_ROW_HEIGHT;

  const describePoint = (index: number) => {
    const point = points[index]!;
    return { title: bucketLongLabel(point, bucket), coverage: coverageNote(sumCoverage(lines, index)) };
  };

  function moveTo(index: number) {
    setActive(Math.max(0, Math.min(points.length - 1, index)));
  }

  function onPlotKey(event: KeyboardEvent) {
    const keys: Record<string, () => void> = {
      ArrowRight: () => moveTo((active ?? -1) + 1),
      ArrowLeft: () => moveTo((active ?? 1) - 1),
      Home: () => moveTo(0),
      End: () => moveTo(points.length - 1),
      Escape: () => setActive(null),
    };
    const action = keys[event.key];
    if (action) {
      event.preventDefault();
      action();
    }
  }

  function onPointer(event: PointerEvent<SVGRectElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width === 0) return;
    moveTo(Math.floor(((event.clientX - box.left) / box.width) * points.length));
  }

  const endYs = lines.map((line) => {
    const index = lastKnown(line.points);
    return index === -1 ? plotBottom : y(line.points[index]!.value!);
  });
  const labelYs = labelPositions(endYs, margin.top + 6, plotBottom - 6);
  const patternId = `${baseId}-hatch`;
  const tooltipId = `${baseId}-tooltip`;
  const singleColumnWidth = Math.min(MAX_COLUMN, Math.max(2, step - 4));

  const table = costChartTable({ ariaLabel, lines, bucket, format, unitLabel, markers });

  const legend = lines.length >= 2 ? <ChartLegend items={lines.map((line) => ({ id: line.key ?? "none", label: line.label, color: line.style.color }))} /> : undefined;
  const activeInfo = active === null ? null : describePoint(active);
  const tooltipLeft = active === null ? 0 : Math.max(0, Math.min(width - 220, xOf(active) + 12));

  const chart = (
    <div ref={measure} className="cost-chart" style={{ position: "relative" }}>
      {tagAreaHeight > 0 && (
        <div className="cost-chart-tags" style={{ position: "relative", height: tagAreaHeight }}>
          {placedMarkers.map(({ group, index }, position) => {
            const open = openMarker === index;
            const markerTooltipId = `${baseId}-marker-${index}`;
            return (
              <div key={`${group.kind ?? "documented"}-${group.date}-${group.modelId}`}>
                <button
                  type="button"
                  className="cost-marker-tag"
                  style={{ left: tagLefts[position], top: rows[position]! * TAG_ROW_HEIGHT }}
                  aria-describedby={open ? `${baseId}-marker-${index}-text ${markerTooltipId}` : `${baseId}-marker-${index}-text`}
                  onFocus={() => setOpenMarker(index)}
                  onBlur={() => setOpenMarker(null)}
                  onMouseEnter={() => setOpenMarker(index)}
                  onMouseLeave={() => setOpenMarker(null)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && open) {
                      event.preventDefault();
                      event.stopPropagation();
                      setOpenMarker(null);
                    }
                  }}
                >
                  {group.label}
                </button>
                <span id={`${baseId}-marker-${index}-text`} className="sr-only">
                  {priceMarkerDescription(group)}
                </span>
                {open &&
                  (group.observed ? (
                    <ObservedMarkerTooltip id={markerTooltipId} group={group} left={Math.min(tagLefts[position]!, Math.max(0, width - 320))} top={tagAreaHeight + 4} />
                  ) : (
                    <PriceMarkerTooltip id={markerTooltipId} group={group} left={Math.min(tagLefts[position]!, Math.max(0, width - 320))} top={tagAreaHeight + 4} />
                  ))}
              </div>
            );
          })}
        </div>
      )}
      <div
        className="cost-chart-plot"
        role="group"
        tabIndex={0}
        aria-label={`${ariaLabel}. Arrow keys read each ${bucket}.`}
        aria-describedby={activeInfo ? tooltipId : undefined}
        onFocus={() => setActive((current) => current ?? 0)}
        onBlur={() => setActive(null)}
        onKeyDown={onPlotKey}
      >
        <svg width={width} height={height} className="chart-svg" aria-hidden="true">
          <defs>
            <pattern id={patternId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--color-bg)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke={lines[0]!.style.color} strokeWidth="2" />
            </pattern>
          </defs>
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={margin.left} x2={margin.left + plotWidth} y1={y(tick)} y2={y(tick)} className="chart-grid" />
              <text x={margin.left - 6} y={y(tick)} dy="0.32em" textAnchor="end" className="chart-axis-text">
                {formatTick(tick)}
              </text>
            </g>
          ))}
          {reference !== undefined && <line x1={margin.left} x2={margin.left + plotWidth} y1={y(reference)} y2={y(reference)} className="chart-baseline" />}
          {points.map((point, index) =>
            index % labelEvery === 0 ? (
              <text key={point.period} x={xOf(index)} y={plotBottom + 15} textAnchor="middle" className="chart-axis-text">
                {axisLabel(point, bucket)}
              </text>
            ) : null,
          )}
          {gapIndexes.map((index) => (
            <g key={points[index]!.period} data-gap={points[index]!.period}>
              <rect x={xOf(index) - Math.min(step, 28) / 2} y={margin.top} width={Math.min(step, 28)} height={plotBottom - margin.top} className="cost-gap-band" />
              {!compact && (
                <text x={xOf(index)} y={margin.top - 6} textAnchor="middle" className="chart-axis-text">
                  unknown
                </text>
              )}
            </g>
          ))}
          {placedMarkers.map(({ group, x }) => (
            <line
              key={`${group.kind ?? "documented"}-${group.date}-${group.modelId}`}
              data-marker={group.date}
              x1={x}
              x2={x}
              y1={margin.top}
              y2={plotBottom}
              className={group.observed ? "cost-marker-line-observed" : "cost-marker-line"}
            />
          ))}
          {columns
            ? lines[0]!.points.map((point, index) => {
                if (point.value === null || point.value <= 0) return null;
                const top = y(point.value);
                const x = xOf(index) - singleColumnWidth / 2;
                return (
                  <g key={point.period} data-column={point.period}>
                    <path d={roundedTopRectPath(x, top, singleColumnWidth, Math.max(1, plotBottom - top), 4)} fill={lines[0]!.style.color} />
                    {point.partial && (
                      <rect data-partial-cap x={x} y={top - 8} width={singleColumnWidth} height={8} fill={`url(#${patternId})`} stroke={lines[0]!.style.color} strokeWidth={1} />
                    )}
                  </g>
                );
              })
            : lines.map((line) => (
                <g key={line.key ?? "none"} data-line={line.key ?? "none"}>
                  {segments(line.points).map((run) =>
                    run.length === 1 ? (
                      <circle key={run[0]} cx={xOf(run[0]!)} cy={y(line.points[run[0]!]!.value!)} r={3} fill={line.style.color} />
                    ) : (
                      <path
                        key={run[0]}
                        d={run.map((index, position) => `${position === 0 ? "M" : "L"}${xOf(index).toFixed(1)},${y(line.points[index]!.value!).toFixed(1)}`).join(" ")}
                        fill="none"
                        stroke={line.style.color}
                        strokeWidth={2}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        style={{ strokeDasharray: line.style.dash }}
                      />
                    ),
                  )}
                  {line.points.map((point, index) =>
                    point.partial && point.value !== null ? (
                      <circle key={point.period} cx={xOf(index)} cy={y(point.value)} r={4} className="cost-partial-point" stroke={line.style.color} />
                    ) : null,
                  )}
                  {lastKnown(line.points) !== -1 && (
                    <circle cx={xOf(lastKnown(line.points))} cy={y(line.points[lastKnown(line.points)]!.value!)} r={4} fill={line.style.color} className="cost-end-dot" />
                  )}
                </g>
              ))}
          {showDirectLabels &&
            lines.map((line, index) => {
              const last = lastKnown(line.points);
              return (
                <g key={line.key ?? "none"} data-direct-label>
                  <text x={margin.left + plotWidth + 10} y={labelYs[index]} className="cost-direct-label">
                    {truncate(line.label, 18)}
                  </text>
                  <text x={margin.left + plotWidth + 10} y={labelYs[index]! + 13} className="cost-direct-value">
                    {last === -1 ? "unknown" : format(line.points[last]!.value!)}
                  </text>
                </g>
              );
            })}
          <line x1={margin.left} x2={margin.left + plotWidth} y1={plotBottom} y2={plotBottom} className="chart-baseline" />
          {active !== null && <line x1={xOf(active)} x2={xOf(active)} y1={margin.top} y2={plotBottom} className="cost-crosshair" />}
          <rect
            x={margin.left}
            y={margin.top}
            width={plotWidth}
            height={plotBottom - margin.top}
            fill="transparent"
            onPointerMove={onPointer}
            onPointerLeave={() => setActive(null)}
          />
        </svg>
        {activeInfo && active !== null && (
          <div id={tooltipId} role="tooltip" className="chart-tooltip cost-tooltip" style={{ left: tooltipLeft, top: tagAreaHeight + margin.top }}>
            <div className="chart-tooltip-title">{activeInfo.title}</div>
            {lines.map((line) => {
              const point = line.points[active]!;
              return (
                <div key={line.key ?? "none"} className="chart-tooltip-row">
                  <span className="cost-tooltip-key" style={{ background: line.style.color }} aria-hidden="true" />
                  <span>{line.label}</span>
                  <span>{point.value === null ? "unknown" : format(point.value)}</span>
                </div>
              );
            })}
            <div className="text-muted">Coverage: {activeInfo.coverage}</div>
            {lines
              .filter((line) => line.points[active]!.knownTurns < line.points[active]!.turns && lines.length > 1)
              .map((line) => (
                <div key={line.key ?? "none"} className="text-muted">
                  {line.label}: {coverageNote(line.points[active]!)}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );

  if (compact) return chart;
  return (
    <ViewAsTable table={table} legend={legend}>
      {chart}
    </ViewAsTable>
  );
}

// The chart's "View as table" twin (also the small multiples' one): a row
// per bucket, a column per series in the shown unit, coverage, then each
// price change in a row of its own. Unknown cells read "unknown".
export function costChartTable({
  ariaLabel,
  lines,
  bucket,
  format,
  unitLabel,
  markers = [],
}: Pick<CostTimeChartProps, "ariaLabel" | "lines" | "bucket" | "format" | "unitLabel" | "markers">) {
  const points = lines[0]?.points ?? [];
  return {
    caption: ariaLabel,
    rowHeader: bucket === "day" ? "Day" : bucket === "week" ? "Week" : "Month",
    columns: [...lines.map((line) => `${line.label} (${unitLabel})`), "Coverage"],
    rows: [
      ...points.map(
        (point, index): ChartDataRow => ({
          key: point.period,
          header: bucketLongLabel(point, bucket),
          cells: [...lines.map((line) => (line.points[index]!.value === null ? null : format(line.points[index]!.value!))), coverageNote(sumCoverage(lines, index))],
        }),
      ),
      ...markers.map(
        (group): ChartDataRow =>
          group.observed
            ? {
                key: `observed-${group.date}-${group.modelId}`,
                header: `Observed change ${longDate(group.date)}`,
                cells: [`${group.modelId} (${channelsOf(group)}): ${observedSentence(group.observed)}; inferred, not documented`, ...lines.map(() => "")],
              }
            : {
                key: `marker-${group.date}-${group.modelId}`,
                header: `Price change ${longDate(group.date)}`,
                cells: [`${group.modelId} (${channelsOf(group)}): ${changeSentence(group)}`, ...lines.map(() => "")],
              },
      ),
    ],
  };
}

function sumCoverage(lines: readonly ChartLine[], index: number) {
  return lines.reduce((sum, line) => ({ turns: sum.turns + line.points[index]!.turns, knownTurns: sum.knownTurns + line.points[index]!.knownTurns }), { turns: 0, knownTurns: 0 });
}

function axisLabel(point: ChartPoint, bucket: CostBucket): string {
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(point.start.slice(5, 7)) - 1];
  return bucket === "month" ? `${month} ${point.start.slice(2, 4)}` : `${month} ${Number(point.start.slice(8, 10))}`;
}

function truncate(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

// Step 15.10: an observed change's evidence, week by week.
function ObservedMarkerTooltip({ id, group, left, top }: { id: string; group: PriceMarkerGroup; left: number; top: number }) {
  const change = group.observed!;
  return (
    <div id={id} role="tooltip" className="chart-tooltip cost-marker-tooltip" style={{ left, top }}>
      <div className="chart-tooltip-title">Observed change {"·"} {longDate(group.date)}</div>
      <div className="text-muted">
        {group.modelId} {"·"} {channelsOf(group)} {"·"} inferred, not documented
      </div>
      <table className="cost-marker-prices">
        <caption className="sr-only">Billed and priced AI Credits per week</caption>
        <thead>
          <tr>
            <th scope="col">Week</th>
            <th scope="col">Turns</th>
            <th scope="col">Billed</th>
            <th scope="col">Priced</th>
            <th scope="col">Ratio</th>
          </tr>
        </thead>
        <tbody>
          {change.weeks.map((week) => (
            <tr key={week.period}>
              <th scope="row">{week.period}</th>
              <td>{week.turns}</td>
              <td>{week.billedAiCredits.toFixed(2)}</td>
              <td>{week.pricedAiCredits.toFixed(2)}</td>
              <td>×{week.ratio.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-muted">Check the price book: a change it doesn't have yet?</div>
      <div className="text-muted">Escape closes</div>
    </div>
  );
}

function PriceMarkerTooltip({ id, group, left, top }: { id: string; group: PriceMarkerGroup; left: number; top: number }) {
  const sources = [...new Set(group.markers.flatMap((marker) => marker.sourceIds))];
  return (
    <div id={id} role="tooltip" className="chart-tooltip cost-marker-tooltip" style={{ left, top }}>
      <div className="chart-tooltip-title">Price change {"·"} {longDate(group.date)}</div>
      <div className="text-muted">
        {group.modelId} {"·"} documented
      </div>
      <table className="cost-marker-prices">
        <caption className="sr-only">Unit prices before and after, USD per million tokens</caption>
        <thead>
          <tr>
            <th scope="col">USD / 1M tokens</th>
            <th scope="col">Before</th>
            <th scope="col">After</th>
            <th scope="col">Change</th>
          </tr>
        </thead>
        {group.markers.map((marker) => (
          <tbody key={marker.channel}>
            <tr>
              <th scope="colgroup" colSpan={4}>
                {channelLabel(marker.channel)}
              </th>
            </tr>
            {marker.changes.map((change) => (
              <tr key={`${change.tier}-${change.tokenType}`}>
                <th scope="row">{tokenTypeLabel(change)}</th>
                <td>{formatUnitPrice(change.fromUsdPerM)}</td>
                <td>{formatUnitPrice(change.toUsdPerM)}</td>
                <td>{percentText(change.percent)}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
      <div className="text-muted">
        Sources: {sources.slice(0, 2).join(", ")}
        {sources.length > 2 ? ` and ${sources.length - 2} more` : ""}
      </div>
      <div className="text-muted">Price version: {group.markers.map((marker) => marker.toVersionId).join(", ")}</div>
      <div className="text-muted">Escape closes</div>
    </div>
  );
}
