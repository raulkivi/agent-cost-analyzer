// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useId } from "react";
import type { TurnChart as TurnChartModel } from "../../view-models/index.js";

// One column per turn. An unknown turn is a hatched
// gap, not a zero column (constraint 6), and a turn with a compaction or
// model switch carries a diamond marker. Drawn here because the shared
// charts have neither (plan §5.5 board).

const WIDTH = 566;
const HEIGHT = 120;
const LEFT = 26;
const TOP = 10;
const BASE = 100;
const MARKER = 4;
// In viewBox units. Narrow hosts enlarge the label font to 18 units (views.css)
// so it stays readable after the chart scales down; "100" is then ~32 units
// wide, and 48 leaves a gap at every width.
export const MIN_LABEL_SPACING = 48;

// Which columns get a turn-number label: every Nth, so labels never crowd,
// plus the first and last so the reader can see the range. A pick that would
// land within N of the last is dropped in favour of the last.
export function selectLabelIndices(count: number, step: number, minSpacing: number): number[] {
  if (count <= 0) return [];
  const stride = Math.max(1, Math.ceil(minSpacing / step));
  const last = count - 1;
  const picked: number[] = [];
  for (let index = 0; index + stride <= last; index += stride) picked.push(index);
  picked.push(last);
  return picked;
}

// The chart's accessible name (A14): role="img" hides each column's <title>
// from assistive tech, so the name says what a sighted reader takes from the
// chart: its size, its peak and how much of it is unknown.
export function describeTurnChart(chart: TurnChartModel): string {
  const { points } = chart;
  const parts = [`${chart.title}, ${points.length} ${points.length === 1 ? "turn" : "turns"}`];
  const peak = points.reduce<TurnChartModel["points"][number] | undefined>((best, point) => (point.value !== null && (best === undefined || point.value > (best.value ?? -Infinity)) ? point : best), undefined);
  if (peak !== undefined) parts.push(`highest ${peak.text} at turn ${peak.turnIndex}`);
  const unknown = points.filter((point) => point.value === null).length;
  if (unknown > 0) parts.push(`${unknown} ${unknown === 1 ? "turn" : "turns"} unknown`);
  return parts.join("; ");
}

export function TurnChart({ chart }: { chart: TurnChartModel }) {
  const hatchId = `hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const { points } = chart;
  if (points.length === 0) return <p className="text-muted chart-empty">No turns.</p>;

  const plotWidth = WIDTH - LEFT - 4;
  const step = plotWidth / points.length;
  const barWidth = Math.max(0.5, Math.min(14, step * 0.7));
  const max = chart.maxValue !== null && chart.maxValue > 0 ? chart.maxValue : 1;
  const plotHeight = BASE - TOP - MARKER * 2;
  const x = (index: number) => LEFT + index * step + (step - barWidth) / 2;
  const labelled = selectLabelIndices(points.length, step, MIN_LABEL_SPACING);

  return (
    <svg className="view-chart" role="img" aria-label={describeTurnChart(chart)} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%">
      <defs>
        <pattern id={hatchId} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="2.5" y1="0" x2="2.5" y2="5" stroke="var(--color-text-muted)" strokeWidth="1.4" />
        </pattern>
      </defs>
      <line x1={LEFT} x2={WIDTH - 4} y1={BASE} y2={BASE} stroke="var(--color-border-tertiary, var(--color-divider))" />
      <text x={LEFT - 5} y={BASE + 3} textAnchor="end" className="view-chart-axis">
        0
      </text>
      {chart.maxText !== null && (
        <text x={LEFT - 5} y={BASE - plotHeight + 3} textAnchor="end" className="view-chart-axis">
          {chart.maxText}
        </text>
      )}
      {labelled.map((index) => (
        // Duplicates the accessible name's turn list, so assistive tech skips it.
        <text key={points[index]!.turnIndex} data-turn-label="" aria-hidden="true" x={x(index) + barWidth / 2} y={BASE + 13} textAnchor="middle" className="view-chart-axis">
          {points[index]!.turnIndex}
        </text>
      ))}
      {points.map((point, index) => {
        const label = `Turn ${point.turnIndex}`;
        if (point.value === null) {
          return (
            <rect key={point.turnIndex} data-unknown="" x={x(index)} y={BASE - plotHeight} width={barWidth} height={plotHeight} fill={`url(#${hatchId})`}>
              <title>{`${label}: Unknown`}</title>
            </rect>
          );
        }
        const height = point.value > 0 ? Math.max(1, (point.value / max) * plotHeight) : 1;
        const detail = [`${label}: ${point.text} ${chart.unitLabel}${point.estimate ? " (estimate)" : ""}`, ...point.eventLabels].join(", ");
        return (
          <g key={point.turnIndex}>
            <rect x={x(index)} y={BASE - height} width={barWidth} height={height} fill="var(--brand-accent)">
              <title>{detail}</title>
            </rect>
            {point.eventLabels.length > 0 && (
              <path data-event="" d={`M${x(index) + barWidth / 2} ${BASE - height - MARKER * 2} l${MARKER} ${MARKER} l${-MARKER} ${MARKER} l${-MARKER} ${-MARKER} z`} fill="var(--brand-accent-strong)" />
            )}
          </g>
        );
      })}
    </svg>
  );
}
