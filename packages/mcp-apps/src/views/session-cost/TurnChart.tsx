import { useId } from "react";
import type { TurnChart as TurnChartModel } from "../../view-models/index.js";

// AI Credits per turn: one column per turn. An unknown turn is a hatched
// gap, not a zero column (constraint 6), and a turn with a compaction or
// model switch carries a diamond marker. Drawn here because the shared
// charts have neither (plan §5.5 board).

const WIDTH = 566;
const HEIGHT = 118;
const LEFT = 26;
const TOP = 10;
const BASE = 100;
const MARKER = 4;

export function TurnChart({ chart, formatValue }: { chart: TurnChartModel; formatValue: (value: number) => string }) {
  const hatchId = `hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const { points } = chart;
  if (points.length === 0) return <p className="text-muted chart-empty">No turns.</p>;

  const plotWidth = WIDTH - LEFT - 4;
  const step = plotWidth / points.length;
  const barWidth = Math.max(0.5, Math.min(14, step * 0.7));
  const max = chart.maxValue !== null && chart.maxValue > 0 ? chart.maxValue : 1;
  const plotHeight = BASE - TOP - MARKER * 2;
  const x = (index: number) => LEFT + index * step + (step - barWidth) / 2;

  return (
    <svg className="view-chart" role="img" aria-label={`AI Credits per turn, ${points.length} turns`} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%">
      <defs>
        <pattern id={hatchId} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="2.5" y1="0" x2="2.5" y2="5" stroke="var(--color-text-muted)" strokeWidth="1.4" />
        </pattern>
      </defs>
      <line x1={LEFT} x2={WIDTH - 4} y1={BASE} y2={BASE} stroke="var(--color-border-tertiary, var(--color-divider))" />
      <text x={LEFT - 5} y={BASE + 3} textAnchor="end" className="view-chart-axis">
        0
      </text>
      {chart.maxValue !== null && (
        <text x={LEFT - 5} y={BASE - plotHeight + 3} textAnchor="end" className="view-chart-axis">
          {formatValue(chart.maxValue)}
        </text>
      )}
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
        const detail = [`${label}: ${point.text} AI Credits${point.estimate ? " (estimate)" : ""}`, ...point.eventLabels].join(", ");
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
