// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { formatAmount, unitLabel, type DisplayUnit } from "../lib/cost/cost-format.js";
import { formatSigned, type WaterfallStep } from "../lib/cost/project-model.js";
import { ViewAsTable } from "./ViewAsTable.js";

// Phase 15 step 15.10 (plan §8.4, §11.4; board 3): the price-versus-usage
// waterfall, from period A's cost through the usage, price and mix effects
// to period B's. Totals stand on the axis; effects float between the levels
// they move between, joined by dashed connectors. Increases and decreases
// use the diverging pair and always carry their written sign (never colour
// alone); "View as table" gives the same figures.

interface WaterfallProps {
  ariaLabel: string;
  steps: WaterfallStep[];
  unit: DisplayUnit;
}

const WIDTH = 480;
const HEIGHT = 240;
const MARGIN = { top: 24, right: 8, bottom: 28, left: 8 };

const valueText = (step: WaterfallStep, unit: DisplayUnit) => (step.kind === "total" ? formatAmount(step.value, unit) : formatSigned(step.value, unit));

export function waterfallDescription(ariaLabel: string, steps: readonly WaterfallStep[], unit: DisplayUnit): string {
  const parts = steps.map((step) => `${step.kind === "total" ? step.label : step.label.toLowerCase()} ${valueText(step, unit)}`);
  return `${ariaLabel}. ${parts.join(", ")} ${unitLabel(unit)}.`;
}

export function Waterfall({ ariaLabel, steps, unit }: WaterfallProps) {
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const max = Math.max(1e-9, ...steps.flatMap((step) => [step.from, step.to]));
  const y = (value: number) => MARGIN.top + plotHeight - (Math.max(0, value) / max) * plotHeight;
  const slot = plotWidth / steps.length;
  const barWidth = Math.min(56, slot * 0.6);
  const x = (index: number) => MARGIN.left + slot * index + (slot - barWidth) / 2;
  const baseline = y(0);

  const table = {
    caption: `${ariaLabel}. Effects add up to the change exactly`,
    rowHeader: "Step",
    columns: [unitLabel(unit)],
    rows: steps.map((step) => ({ key: step.key, header: step.label, cells: [valueText(step, unit)] })),
  };

  return (
    <ViewAsTable table={table}>
      <svg role="img" aria-label={waterfallDescription(ariaLabel, steps, unit)} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" className="waterfall">
        <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={baseline} y2={baseline} className="waterfall-axis" />
        {steps.slice(0, -1).map((step, index) => (
          <line key={`link-${step.key}`} x1={x(index) + barWidth} x2={x(index + 1)} y1={y(step.to)} y2={y(step.to)} className="waterfall-link" />
        ))}
        {steps.map((step, index) => {
          const top = y(Math.max(step.from, step.to));
          const bottom = y(Math.min(step.from, step.to));
          const center = x(index) + barWidth / 2;
          return (
            <g key={step.key}>
              <rect
                data-step={step.key}
                data-kind={step.kind}
                className={`waterfall-bar waterfall-${step.kind}`}
                x={x(index)}
                y={top}
                width={barWidth}
                height={Math.max(1, bottom - top)}
                rx={2}
              />
              <text data-value={step.key} x={center} y={top - 6} textAnchor="middle" className="waterfall-value">
                {valueText(step, unit)}
              </text>
              <text x={center} y={HEIGHT - 8} textAnchor="middle" className="waterfall-name">
                {step.label}
              </text>
            </g>
          );
        })}
      </svg>
    </ViewAsTable>
  );
}
