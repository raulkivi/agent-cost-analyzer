// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useState } from "react";
import type { ReactNode } from "react";
import { ChartDataTable, type ChartDataTableProps } from "./ChartDataTable.js";

interface ViewAsTableProps {
  table: ChartDataTableProps;
  // Stays in the toolbar in both views.
  legend?: ReactNode;
  // The panel's kicker, set on the toolbar row instead of a row of its own.
  kicker?: ReactNode;
  // The chart itself.
  children: ReactNode;
}

// A chart's toolbar and its "View as table" switch: a real toggle button
// (aria-pressed, its name never changes) that swaps the chart for the
// ChartDataTable of the same data.
export function ViewAsTable({ table, legend, kicker, children }: ViewAsTableProps) {
  const [showTable, setShowTable] = useState(false);
  return (
    <div className="chart">
      <div className="chart-toolbar">
        {kicker !== undefined ? <span className="card-kicker">{kicker}</span> : (legend ?? <span />)}
        <button
          type="button"
          className="btn btn-ghost chart-table-toggle"
          aria-pressed={showTable}
          onClick={() => setShowTable((current) => !current)}
        >
          View as table
        </button>
      </div>
      {/* With a kicker the toolbar row is full: the legend takes the next one. */}
      {kicker !== undefined && legend}
      {showTable ? <ChartDataTable {...table} /> : children}
    </div>
  );
}
