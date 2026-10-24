import { useState } from "react";
import type { ReactNode } from "react";
import { ChartDataTable, type ChartDataTableProps } from "./ChartDataTable.js";

interface ViewAsTableProps {
  table: ChartDataTableProps;
  // Stays in the toolbar in both views.
  legend?: ReactNode;
  // The chart itself.
  children: ReactNode;
}

// A chart's toolbar and its "View as table" switch: a real toggle button
// (aria-pressed, its name never changes) that swaps the chart for the
// ChartDataTable of the same data.
export function ViewAsTable({ table, legend, children }: ViewAsTableProps) {
  const [showTable, setShowTable] = useState(false);
  return (
    <div className="chart">
      <div className="chart-toolbar">
        {legend ?? <span />}
        <button
          type="button"
          className="btn btn-ghost chart-table-toggle"
          aria-pressed={showTable}
          onClick={() => setShowTable((current) => !current)}
        >
          View as table
        </button>
      </div>
      {showTable ? <ChartDataTable {...table} /> : children}
    </div>
  );
}
