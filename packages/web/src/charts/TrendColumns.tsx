// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { scaleLinear } from "d3-scale";
import { useContainerWidth } from "../lib/use-container-width.js";
import { roundedTopRectPath } from "./chart-parts.js";
import { ViewAsTable } from "./ViewAsTable.js";

export interface TrendColumn {
  key: string;
  label: string;
  value: number;
  note?: string; // e.g. coverage, shown in the label/tooltip and table
}

interface TrendColumnsProps {
  ariaLabel: string;
  columns: TrendColumn[];
  format: (value: number) => string;
  // Name the x axis and the measure in the table view ("Day", "AI Credits").
  axisLabel?: string;
  valueLabel?: string;
  selectedKeys?: readonly string[];
  onSelect?: (key: string, additive: boolean) => void;
  emptyText?: string;
  // Shown on the toolbar row beside "View as table".
  kicker?: ReactNode;
}

const HEIGHT = 120;
const MARGIN = { top: 10, right: 8, bottom: 24, left: 40 };
// Below MIN_STEP columns scroll (.chart-scroll) rather than squeeze; above
// it the step grows to fill the panel so two days are not a 100px sliver.
const FALLBACK_STEP = 26;
const MIN_STEP = 14;
const MAX_BAR = 24;
const MAX_X_LABELS = 20;
// .chart-axis-text is 10px with tabular figures: about 6px a character,
// plus a gap so neighbouring labels never touch.
const LABEL_CHAR_WIDTH = 6;
const LABEL_GAP = 6;
// An identity colour, not the accent: the accent is the button background,
// black like the page in High Contrast (step 10.17 G7, check 1.8).
const COLOR = "var(--color-series-1)";

// One measure over time as columns: click (Ctrl/⌘ to add) selects a column
// — a selection surface like a QlikView chart — plus "View as table".
export function TrendColumns({
  ariaLabel,
  columns,
  format,
  axisLabel = "Period",
  valueLabel = "Value",
  selectedKeys = [],
  onSelect,
  emptyText,
  kicker,
}: TrendColumnsProps) {
  // Hooks run before the empty-state return to keep their order stable.
  const [scrollRef, containerWidth] = useContainerWidth<HTMLDivElement>();
  if (columns.length === 0) {
    return (
      <>
        {kicker !== undefined && <div className="card-kicker">{kicker}</div>}
        <p className="text-muted chart-empty">{emptyText ?? "No data."}</p>
      </>
    );
  }
  // Text stays undistorted because the svg is drawn at its real pixel width
  // instead of being stretched by a viewBox. Unmeasured (no ResizeObserver,
  // first paint) keeps the fixed step.
  const step = containerWidth === undefined ? FALLBACK_STEP : Math.max(MIN_STEP, (containerWidth - MARGIN.left - MARGIN.right) / columns.length);
  const width = MARGIN.left + MARGIN.right + columns.length * step;
  const plotBottom = HEIGHT - MARGIN.bottom;
  const max = Math.max(...columns.map((column) => column.value), 0);
  const y = scaleLinear()
    .domain([0, max > 0 ? max : 1])
    .nice()
    .range([plotBottom, MARGIN.top]);
  const ticks = y.ticks(4);
  const widestLabel = Math.max(...columns.map((column) => column.label.length)) * LABEL_CHAR_WIDTH + LABEL_GAP;
  const labelEvery = Math.max(Math.ceil(columns.length / MAX_X_LABELS), Math.ceil(widestLabel / step));
  const hasNotes = columns.some((column) => column.note);
  const describe = (column: TrendColumn) =>
    `${column.label}: ${format(column.value)}${column.note ? ` (${column.note})` : ""}`;

  return (
    <ViewAsTable
      kicker={kicker}
      table={{
        caption: ariaLabel,
        rowHeader: axisLabel,
        columns: hasNotes ? [valueLabel, "Note"] : [valueLabel],
        rows: columns.map((column) => ({
          key: column.key,
          header: column.label,
          cells: hasNotes ? [format(column.value), column.note ?? ""] : [format(column.value)],
        })),
      }}
    >
      <div className="chart-scroll" ref={scrollRef}>
        <svg role="group" aria-label={ariaLabel} width={width} height={HEIGHT} className="chart-svg">
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)} className="chart-grid" />
              <text x={MARGIN.left - 6} y={y(tick)} dy="0.32em" textAnchor="end" className="chart-axis-text">
                {format(tick)}
              </text>
            </g>
          ))}
          {columns.map((column, index) => {
            const bandX = MARGIN.left + index * step;
            const barWidth = Math.min(MAX_BAR, step - 6);
            const barX = bandX + (step - barWidth) / 2;
            const selected = selectedKeys.includes(column.key);
            const select = (event: MouseEvent | KeyboardEvent) =>
              onSelect?.(column.key, event.ctrlKey || event.metaKey);
            const top = y(column.value);
            return (
              <g
                key={column.key}
                role="button"
                tabIndex={0}
                aria-label={describe(column)}
                aria-pressed={selected}
                className="chart-column"
                onClick={select}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    select(event);
                  }
                }}
              >
                <title>{describe(column)}</title>
                <rect
                  x={bandX + 1}
                  y={MARGIN.top}
                  width={step - 2}
                  height={plotBottom - MARGIN.top}
                  className={selected ? "chart-band chart-band--selected" : "chart-band"}
                />
                {column.value > 0 && (
                  <path d={roundedTopRectPath(barX, top, barWidth, Math.max(1, plotBottom - top), 4)} fill={COLOR} />
                )}
                {index % labelEvery === 0 && (
                  <text x={bandX + step / 2} y={plotBottom + 15} textAnchor="middle" className="chart-axis-text">
                    {column.label}
                  </text>
                )}
              </g>
            );
          })}
          <line x1={MARGIN.left} x2={width - MARGIN.right} y1={plotBottom} y2={plotBottom} className="chart-baseline" />
        </svg>
      </div>
    </ViewAsTable>
  );
}
