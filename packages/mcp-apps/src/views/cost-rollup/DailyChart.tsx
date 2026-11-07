// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useId } from "react";
import type { CostRollupViewModel } from "../../view-models/index.js";

// Daily AI Credits: one column per day. An unknown day is a hatched gap,
// not a zero column (constraint 6). Drawn here because the shared
// TrendColumns has no gap state (plan §5.5 board).

const WIDTH = 566;
const HEIGHT = 116;
const LEFT = 30;
const TOP = 10;
const BASE = 98;
const MAX_LABELS = 8;

export function DailyChart({ daily, formatValue }: { daily: CostRollupViewModel["daily"]; formatValue: (value: number) => string }) {
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
    <svg className="view-chart" role="img" aria-label={`Daily AI Credits, ${points.length} ${points.length === 1 ? "day" : "days"}`} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%">
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
          {formatValue(daily.maxValue)}
        </text>
      )}
      {points.map((point, index) => {
        const height = point.value !== null && point.value > 0 ? Math.max(1, (point.value / max) * plotHeight) : 1;
        return (
          <g key={point.date}>
            {point.value === null ? (
              <rect data-unknown="" x={x(index)} y={TOP} width={barWidth} height={plotHeight} fill={`url(#${hatchId})`}>
                <title>{`${point.label}: Unknown`}</title>
              </rect>
            ) : (
              <rect x={x(index)} y={BASE - height} width={barWidth} height={height} fill="var(--brand-accent)">
                <title>{`${point.label}: ${point.text} AI Credits`}</title>
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
