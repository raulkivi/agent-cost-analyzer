export interface ChartDataRow {
  key: string;
  // The row's label, rendered as its row header.
  header: string;
  // One entry per column, already formatted exactly as the chart shows it
  // (same units, same rounding). null means unknown — shown as "unknown",
  // never as 0 (architecture constraint 6).
  cells: (string | null)[];
}

export interface ChartDataTableProps {
  // Names the table; usually the chart's own aria-label.
  caption: string;
  // The header of the first column, which holds each row's label.
  rowHeader: string;
  columns: string[];
  rows: ChartDataRow[];
}

export const UNKNOWN_CELL = "unknown";

// The accessible twin of every chart ("View as table", vscode-extension.md
// §3.5): the same data as a plain table, so nothing is only in the picture.
// Shared by all the charts — each maps its own data to rows.
export function ChartDataTable({ caption, rowHeader, columns, rows }: ChartDataTableProps) {
  return (
    <div className="chart-table-wrap">
      <table className="table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{rowHeader}</th>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.header}</th>
              {row.cells.map((cell, index) => (
                <td key={columns[index]}>{cell ?? UNKNOWN_CELL}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
