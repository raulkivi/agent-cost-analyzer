// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { MeasureView, TokenTypeRow } from "../../view-models/index.js";
import "./cost-over-time.css";

// Tokens per model by type (project only). A type the log doesn't record is
// Unknown, never 0; a recorded zero reads 0.

function Cell({ measure }: { measure: MeasureView }) {
  return (
    <td>
      <span className={measure.known ? undefined : "view-unknown"}>{measure.text}</span>
      {measure.coverageNote !== undefined && <span className="ct-coverage text-muted">{measure.coverageNote}</span>}
    </td>
  );
}

export function TokensByType({ rows }: { rows: TokenTypeRow[] }) {
  if (rows.length === 0) return <p className="text-muted">No token figures in this period.</p>;
  return (
    <div className="view-scroll" tabIndex={0} role="region" aria-label="Tokens by type, scrollable">
      <table className="view-table" aria-label="Tokens by type, per model">
        <thead>
          <tr>
            <th className="view-left">Model</th>
            <th>Uncached input</th>
            <th>Cache write</th>
            <th>Cache read</th>
            <th>Reasoning</th>
            <th>Output</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.vendorId ?? ""}:${row.model}`}>
              <td className="view-left view-cell-text">{row.model}</td>
              <Cell measure={row.uncachedInput} />
              <Cell measure={row.cacheWrite} />
              <Cell measure={row.cacheRead} />
              <Cell measure={row.reasoning} />
              <Cell measure={row.output} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
