// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { formatTick } from "@agent-cost-analyzer/web/lib/cost/cost-format";
import { useId } from "react";
import { AXIS_TO_PLOT } from "../cost-over-time/chart-model.js";
import { selectLabelIndices, MIN_LABEL_SPACING } from "../session-cost/TurnChart.js";
import { describeReplayChart } from "./chart-model.js";
import type { ReplayChartModel, ReplayChartPoint } from "./chart-model.js";
import "./replay.css";

// U12's per-turn chart (board Replay, plan §9.2 Q5). Measured is a solid line
// with filled dots, simulated a dashed line with open diamonds, so the two are
// told apart without colour; each carries its own label in the chart, as the
// chart-marks rule asks (a legend alone does not count). Turns not replayed
// are a hatched band, a gap, and a turn with no figure breaks the line.
// Drawn here: the shared charts have neither the gap nor the second series.

const WIDTH = 566;
const HEIGHT = 156;
const TOP = 22;
const BASE = 118;
const RIGHT = 4;
const DIAMOND = 3.4;

function pathOf(points: readonly ReplayChartPoint[], x: (index: number) => number, y: (value: number) => number): string {
  return points.map((point) => `${x(point.index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
}

export function ReplayChart({ chart, model }: { chart: ReplayChartModel; model: string }) {
  const hatchId = `rp-hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const left = chart.leftInset;
  const plotWidth = WIDTH - left - RIGHT;
  const step = chart.count > 1 ? plotWidth / (chart.count - 1) : 0;
  const max = chart.max !== null && chart.max > 0 ? chart.max : 1;
  const x = (index: number) => left + (chart.count > 1 ? index * step : plotWidth / 2);
  const y = (value: number) => BASE - (value / max) * (BASE - TOP);
  const bandHalf = Math.max(3, step / 2);
  const labelled = selectLabelIndices(chart.count, Math.max(step, 1), MIN_LABEL_SPACING);
  const lastMeasured = chart.measured.flat().at(-1);
  const lastSimulated = chart.simulated.flat().at(-1);
  // Direct labels, right-aligned at the last point of each line: the higher
  // line's above it, the lower line's below it, so they never cross each other.
  const measuredAbove = (lastMeasured?.value ?? 0) >= (lastSimulated?.value ?? 0);
  const labelY = (point: ReplayChartPoint, above: boolean) => Math.min(BASE - 3, Math.max(TOP - 2, y(point.value) + (above ? -8 : 15)));

  return (
    <svg className="view-chart" role="img" aria-label={describeReplayChart(chart, model)} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%">
      <defs>
        <pattern id={hatchId} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="2.5" y1="0" x2="2.5" y2="5" stroke="var(--color-text-muted)" strokeWidth="1.4" />
        </pattern>
      </defs>
      <line x1={left} x2={WIDTH - RIGHT} y1={BASE} y2={BASE} stroke="var(--color-divider)" />
      <text x={left - AXIS_TO_PLOT} y={BASE + 3} textAnchor="end" className="view-chart-axis">
        {formatTick(0, chart.unit)}
      </text>
      {chart.max !== null && (
        <text x={left - AXIS_TO_PLOT} y={TOP + 3} textAnchor="end" className="view-chart-axis">
          {formatTick(chart.max, chart.unit)}
        </text>
      )}
      {chart.gaps.map((gap) => {
        const from = x(gap.from) - bandHalf;
        const to = x(gap.to) + bandHalf;
        return (
          <g key={gap.from} data-gap="">
            <rect x={from} y={TOP - 8} width={to - from} height={BASE - TOP + 8} fill={`url(#${hatchId})`} opacity="0.45">
              <title>{gap.title}</title>
            </rect>
            <text x={(from + to) / 2} y={TOP - 11} textAnchor="middle" className="view-chart-axis">
              not replayed
            </text>
          </g>
        );
      })}
      <g data-series="measured" className="rp-series rp-series--measured">
        {chart.measured.map((run) => (
          <g key={run[0]!.index}>
            {run.length > 1 && <polyline points={pathOf(run, x, y)} fill="none" strokeWidth="1.8" />}
            {run.map((point) => (
              <circle key={point.index} cx={x(point.index)} cy={y(point.value)} r="2.3">
                <title>{point.title}</title>
              </circle>
            ))}
          </g>
        ))}
      </g>
      <g data-series="simulated" className="rp-series rp-series--simulated">
        {chart.simulated.map((run) => (
          <g key={run[0]!.index}>
            {run.length > 1 && <polyline points={pathOf(run, x, y)} fill="none" strokeWidth="1.8" strokeDasharray="5 3" />}
            {run.map((point) => {
              const cx = x(point.index);
              const cy = y(point.value);
              return (
                <path key={point.index} d={`M${cx.toFixed(1)} ${(cy - DIAMOND).toFixed(1)}l${DIAMOND} ${DIAMOND}-${DIAMOND} ${DIAMOND}-${DIAMOND}-${DIAMOND}z`} strokeWidth="1.3">
                  <title>{point.title}</title>
                </path>
              );
            })}
          </g>
        ))}
      </g>
      {lastMeasured !== undefined && (
        <text x={x(lastMeasured.index)} y={labelY(lastMeasured, measuredAbove)} textAnchor="end" className="view-chart-axis rp-label rp-label--measured">
          Measured
        </text>
      )}
      {lastSimulated !== undefined && (
        <text x={x(lastSimulated.index)} y={labelY(lastSimulated, !measuredAbove)} textAnchor="end" className="view-chart-axis rp-label rp-label--simulated">
          Simulated
        </text>
      )}
      {labelled.map((index) => (
        <text key={index} x={x(index)} y={HEIGHT - 16} textAnchor="middle" className="view-chart-axis">
          {chart.turnIndexes[index]}
        </text>
      ))}
      <text x={WIDTH - RIGHT} y={HEIGHT - 2} textAnchor="end" className="view-chart-axis">
        turn
      </text>
    </svg>
  );
}
