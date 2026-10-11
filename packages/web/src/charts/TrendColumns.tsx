import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { scaleLinear } from "d3-scale";
import { roundedTopRectPath } from "./chart-parts.js";

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
  selectedKeys?: readonly string[];
  onSelect?: (key: string, additive: boolean) => void;
  emptyText?: string;
}

const HEIGHT = 150;
const MARGIN = { top: 10, right: 8, bottom: 24, left: 40 };
const STEP = 26;
const MAX_BAR = 18;
const MAX_X_LABELS = 20;
const COLOR = "var(--color-accent)";

// One measure over time as columns: click (Ctrl/⌘ to add) selects a column
// — a selection surface like a QlikView chart — plus a table view.
export function TrendColumns({ ariaLabel, columns, format, selectedKeys = [], onSelect, emptyText }: TrendColumnsProps) {
  const [showTable, setShowTable] = useState(false);
  if (columns.length === 0) {
    return <p className="text-muted chart-empty">{emptyText ?? "No data."}</p>;
  }
  const width = MARGIN.left + MARGIN.right + columns.length * STEP;
  const plotBottom = HEIGHT - MARGIN.bottom;
  const max = Math.max(...columns.map((column) => column.value), 0);
  const y = scaleLinear().domain([0, max > 0 ? max : 1]).nice().range([plotBottom, MARGIN.top]);
  const ticks = y.ticks(4);
  const labelEvery = Math.ceil(columns.length / MAX_X_LABELS);
  const describe = (column: TrendColumn) => `${column.label}: ${format(column.value)}${column.note ? ` (${column.note})` : ""}`;

  return (
    <div className="chart">
      <div className="chart-toolbar">
        <span />
        <button type="button" className="btn btn-ghost chart-table-toggle" onClick={() => setShowTable((v) => !v)}>
          {showTable ? "Show chart" : "Show table"}
        </button>
      </div>
      {showTable ? (
        <div className="chart-table-wrap">
          <table className="table">
            <tbody>
              {columns.map((column) => (
                <tr key={column.key}>
                  <td>{column.label}</td>
                  <td>{format(column.value)}</td>
                  <td className="text-muted">{column.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart-scroll">
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
              const bandX = MARGIN.left + index * STEP;
              const barWidth = Math.min(MAX_BAR, STEP - 6);
              const barX = bandX + (STEP - barWidth) / 2;
              const selected = selectedKeys.includes(column.key);
              const select = (event: MouseEvent | KeyboardEvent) => onSelect?.(column.key, event.ctrlKey || event.metaKey);
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
                    width={STEP - 2}
                    height={plotBottom - MARGIN.top}
                    className={selected ? "chart-band chart-band--selected" : "chart-band"}
                  />
                  {column.value > 0 && (
                    <path d={roundedTopRectPath(barX, top, barWidth, Math.max(1, plotBottom - top), 4)} fill={COLOR} />
                  )}
                  {index % labelEvery === 0 && (
                    <text x={bandX + STEP / 2} y={plotBottom + 15} textAnchor="middle" className="chart-axis-text">
                      {column.label}
                    </text>
                  )}
                </g>
              );
            })}
            <line x1={MARGIN.left} x2={width - MARGIN.right} y1={plotBottom} y2={plotBottom} className="chart-baseline" />
          </svg>
        </div>
      )}
    </div>
  );
}
