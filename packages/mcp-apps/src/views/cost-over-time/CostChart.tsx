// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { formatTick } from "@agent-cost-analyzer/web/lib/cost/cost-format";
import type { Currency } from "@agent-cost-analyzer/domain";
import { useId } from "react";
import { AXIS_TO_PLOT, type ChartModel } from "./chart-model.js";
import "./cost-over-time.css";

// U9's cost per bucket (board CostOverTime.dc.html). Drawn here, not with the
// shared CostTimeChart: that chart brings d3-scale, a measured-width hook and
// focusable price-change tag buttons styled by the web app's stylesheet, none
// of which the single-file bundle carries, and it has no "0 turns" bucket.
// What the board needs is small: columns, a hatched cap on a partly known
// bucket (a floor), a hatched gap for an Unknown bucket (never a zero
// column), and price-change markers, solid with a filled diamond for a
// documented change and dashed with a hollow diamond for an inferred one.

const WIDTH = 566;
const HEIGHT = 156;
const TOP = 20;
const BASE = 128;
const MAX_LABELS = 6;
const DIAMOND = 5;

// The chart's accessible name: role="img" hides each bar's <title> from
// assistive tech, so the name carries the size, the peak, the partly known
// and unknown buckets and the markers.
export function describeCostChart(chart: ChartModel, heading: string, noun: string): string {
  const { bars, markers } = chart;
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const parts = [`${heading}, ${chart.unitLabel}, ${plural(bars.length, noun)}`];
  const peak = bars.reduce<ChartModel["bars"][number] | undefined>((best, bar) => (bar.value !== null && (best === undefined || bar.value > (best.value ?? -Infinity)) ? bar : best), undefined);
  if (peak !== undefined) parts.push(`highest ${peak.title}`);
  const partial = bars.filter((bar) => bar.state === "partial").length;
  if (partial > 0) parts.push(`${plural(partial, noun)} partly known`);
  const gaps = bars.filter((bar) => bar.state === "gap").length;
  if (gaps > 0) parts.push(`${plural(gaps, noun)} unknown`);
  const inferred = markers.filter((marker) => marker.inferred).length;
  if (markers.length - inferred > 0) parts.push(`${plural(markers.length - inferred, "documented price change")}`);
  if (inferred > 0) parts.push(`${plural(inferred, "inferred price change")}`);
  return parts.join("; ");
}

export function CostChart({ chart, currency, heading, noun }: { chart: ChartModel; currency: Currency | null; heading: string; noun: string }) {
  const hatchId = `hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const { bars } = chart;
  if (bars.length === 0) return <p className="text-muted chart-empty">{`No ${noun}s in this period.`}</p>;

  const LEFT = chart.leftInset;
  const plotWidth = WIDTH - LEFT - 4;
  const step = plotWidth / bars.length;
  const barWidth = Math.max(1, Math.min(40, step * 0.7));
  const max = chart.max !== null && chart.max > 0 ? chart.max : 1;
  const plotHeight = BASE - TOP;
  const x = (index: number) => LEFT + index * step + (step - barWidth) / 2;
  const labelEvery = Math.ceil(bars.length / MAX_LABELS);
  const unit = currency ?? "AI_CREDITS";

  return (
    <svg className="view-chart" role="img" aria-label={describeCostChart(chart, heading, noun)} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%">
      <defs>
        <pattern id={hatchId} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="2.5" y1="0" x2="2.5" y2="5" stroke="var(--color-text-muted)" strokeWidth="1.4" />
        </pattern>
      </defs>
      <line x1={LEFT} x2={WIDTH - 4} y1={BASE} y2={BASE} stroke="var(--color-divider)" />
      <text x={LEFT - AXIS_TO_PLOT} y={BASE + 3} textAnchor="end" className="view-chart-axis">
        {formatTick(0, unit)}
      </text>
      {chart.max !== null && (
        <text x={LEFT - AXIS_TO_PLOT} y={TOP + 3} textAnchor="end" className="view-chart-axis">
          {formatTick(chart.max, unit)}
        </text>
      )}
      {bars.map((bar, index) => {
        const height = bar.value !== null && bar.value > 0 ? Math.max(1, (bar.value / max) * plotHeight) : 0;
        const top = BASE - height;
        return (
          <g key={bar.period}>
            {bar.state === "gap" && (
              <rect data-gap="" x={x(index)} y={TOP} width={barWidth} height={plotHeight} fill={`url(#${hatchId})`}>
                <title>{bar.title}</title>
              </rect>
            )}
            {bar.state === "empty" && (
              <text data-empty="" x={x(index) + barWidth / 2} y={BASE - 6} transform={`rotate(-90 ${x(index) + barWidth / 2} ${BASE - 6})`} className="view-chart-axis ct-empty">
                0 turns
                <title>{bar.title}</title>
              </text>
            )}
            {(bar.state === "known" || bar.state === "partial") && (
              <>
                <rect data-bar="" x={x(index)} y={top} width={barWidth} height={height} fill="var(--brand-accent)">
                  <title>{bar.title}</title>
                </rect>
                {bar.state === "partial" && (
                  // A floor: the figure covers only some turns, so the cap above the bar is hatched.
                  <rect data-partial="" x={x(index)} y={Math.max(TOP, top - 12)} width={barWidth} height={Math.min(12, top - TOP)} fill={`url(#${hatchId})`} stroke="var(--brand-accent)" strokeWidth="1">
                    <title>{bar.title}</title>
                  </rect>
                )}
              </>
            )}
            {index % labelEvery === 0 && (
              <text x={x(index) + barWidth / 2} y={HEIGHT - 4} textAnchor="middle" className="view-chart-axis">
                {bar.label}
              </text>
            )}
          </g>
        );
      })}
      {chart.markers.map((marker, index) => {
        const at = LEFT + marker.position * step;
        const diamond = `${at},${TOP - 2 - DIAMOND} ${at + DIAMOND},${TOP - 2} ${at},${TOP - 2 + DIAMOND} ${at - DIAMOND},${TOP - 2}`;
        return (
          <g key={`${marker.kind}-${index}`} data-marker={marker.kind} className={marker.inferred ? "ct-marker ct-marker-inferred" : "ct-marker"}>
            <title>{marker.title}</title>
            <line x1={at} x2={at} y1={TOP - 2} y2={BASE} strokeDasharray={marker.inferred ? "4 3" : undefined} />
            <polygon points={diamond} fill={marker.inferred ? "var(--color-bg, transparent)" : "currentColor"} />
          </g>
        );
      })}
    </svg>
  );
}
