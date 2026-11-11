// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useId } from "react";
import type { AuditRollupViewModel } from "../../view-models/index.js";

// Failed calls per day: one column per day. A day with no known outcome is a
// hatched gap, not a zero column (constraint 6); the hatch is a pattern, so
// the gap doesn't rest on colour. Each column's value is in its <title> and
// the chart's name carries the peak, so no figure is colour or height alone.

const WIDTH = 566;
const HEIGHT = 116;
const LEFT = 30;
const TOP = 10;
const BASE = 98;
const MAX_LABELS = 6;

type Daily = AuditRollupViewModel["daily"];

const callsText = (text: string) => `${text} failed ${text === "1" ? "call" : "calls"}`;

export function describeFailedPerDay(daily: Daily): string {
  const { points } = daily;
  const parts = [`Failed calls per day, ${points.length} ${points.length === 1 ? "day" : "days"}`];
  const peak = points.reduce<Daily["points"][number] | undefined>((best, point) => (point.value !== null && (best === undefined || point.value > (best.value ?? -Infinity)) ? point : best), undefined);
  if (peak !== undefined) parts.push(`most ${peak.text} on ${peak.label}`);
  const unknown = points.filter((point) => point.value === null).length;
  if (unknown > 0) parts.push(`${unknown} ${unknown === 1 ? "day" : "days"} unknown`);
  return parts.join("; ");
}

export function FailedPerDayChart({ daily }: { daily: Daily }) {
  const hatchId = `hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const { points } = daily;
  if (points.length === 0) return <p className="text-muted chart-empty">No days in this period.</p>;

  const plotWidth = WIDTH - LEFT - 4;
  const step = plotWidth / points.length;
  const barWidth = Math.max(1, Math.min(48, step * 0.7));
  const max = daily.maxValue !== null && daily.maxValue > 0 ? daily.maxValue : 1;
  const plotHeight = BASE - TOP;
  const x = (index: number) => LEFT + index * step + (step - barWidth) / 2;
  const labelEvery = Math.ceil(points.length / MAX_LABELS);

  return (
    <svg className="view-chart" role="img" aria-label={describeFailedPerDay(daily)} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%">
      <defs>
        <pattern id={hatchId} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="2.5" y1="0" x2="2.5" y2="5" stroke="var(--color-text-muted)" strokeWidth="1.4" />
        </pattern>
      </defs>
      <line x1={LEFT} x2={WIDTH - 4} y1={BASE} y2={BASE} stroke="var(--color-border-tertiary, var(--color-divider))" />
      <text x={LEFT - 5} y={BASE + 3} textAnchor="end" className="view-chart-axis">
        0
      </text>
      {daily.maxValue !== null && (
        <text x={LEFT - 5} y={TOP + 3} textAnchor="end" className="view-chart-axis">
          {daily.maxValue}
        </text>
      )}
      {points.map((point, index) => {
        const height = point.value !== null && point.value > 0 ? Math.max(1, (point.value / max) * plotHeight) : 1;
        return (
          <g key={`${point.label}-${index}`}>
            {point.value === null ? (
              <rect data-unknown="" x={x(index)} y={TOP} width={barWidth} height={plotHeight} fill={`url(#${hatchId})`}>
                <title>{`${point.label}: Unknown`}</title>
              </rect>
            ) : (
              <rect x={x(index)} y={BASE - height} width={barWidth} height={height} fill="var(--brand-accent)">
                <title>{`${point.label}: ${callsText(point.text)}`}</title>
              </rect>
            )}
            {index % labelEvery === 0 && (
              <text x={x(index) + barWidth / 2} y={HEIGHT - 4} textAnchor="middle" className="view-chart-axis">
                {point.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
