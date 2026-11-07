// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useId, useState } from "react";
import { Tag } from "@agent-cost-analyzer/web/ui/Tag";
import type { FindingRow } from "../../view-models/findings.js";
import { SeverityMark } from "./SeverityMark.js";
import "./findings.css";

// Detail and evidence are logged text: shown here as text, collapsed until
// asked for, and never handed to the host's model (plan §6).
function RowDetail({ row }: { row: FindingRow }) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  return (
    <div className="fv-detail">
      <button type="button" className="fv-link" aria-expanded={open} aria-controls={regionId} onClick={() => setOpen(!open)}>
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d={open ? "M6 9l6 6 6-6" : "M9 6l6 6-6 6"} />
        </svg>
        {row.detail.evidence === undefined ? "Why flagged" : "Redacted evidence"}
      </button>
      {open && (
        <div id={regionId}>
          <p className="fv-why">{row.detail.why}</p>
          {row.detail.evidence !== undefined && (
            <>
              <pre className="fv-evidence">{row.detail.evidence}</pre>
              <span className="fv-hint fv-muted">Redacted and bounded by the tool before the view gets it; shown as text, never sent to the chat.</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function FindingsTable({ rows, busy }: { rows: FindingRow[]; busy: boolean }) {
  return (
    <div className="findings-scroll">
      <table className="fv-table" aria-label="Findings" aria-busy={busy}>
        <thead>
          <tr>
            <th>Severity</th>
            <th>Finding</th>
            <th>Kind</th>
            <th>Session</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>
                <span className="fv-sev">
                  <SeverityMark severity={row.severity} />
                  {row.severityLabel}
                </span>
              </td>
              <td className="fv-finding">
                <div>
                  {row.title}{" "}
                  {row.inferred && (
                    <Tag variant="outline" title="Inferred from the logs, not documented by the vendor">
                      inferred
                    </Tag>
                  )}
                </div>
                <RowDetail row={row} />
              </td>
              <td className="fv-muted">{row.kindLabel}</td>
              <td className="fv-session">
                <span>{row.sessionTitle}</span>
                {row.turnText && <span className="fv-muted"> · {row.turnText}</span>}
              </td>
              <td className="fv-muted">{row.whenText ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
