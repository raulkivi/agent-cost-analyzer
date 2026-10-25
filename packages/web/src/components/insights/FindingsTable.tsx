import { useState } from "react";
import type { InsightFinding } from "@agent-cost-analyzer/domain";
import { FINDING_KIND_LABELS, findingCategoryLabel, SEVERITY_LABELS, SEVERITY_ORDER } from "../../lib/insights/insights-model.js";
import { formatWhen } from "../../lib/insights/narrative.js";

const INITIAL_ROWS = 25;

interface FindingsTableProps {
  findings: InsightFinding[];
  sessionTitle: (sessionKey: string) => string;
  onSelectSession: (sessionKey: string) => void;
}

function bySeverityThenLatest(a: InsightFinding, b: InsightFinding): number {
  return SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || (b.at ?? "").localeCompare(a.at ?? "");
}

// "Signals to review": each row answers what happened, when, why it was
// flagged (with redacted evidence) and where — clicking "where" selects
// that session across the whole dashboard.
export function FindingsTable({ findings, sessionTitle, onSelectSession }: FindingsTableProps) {
  const [showAll, setShowAll] = useState(false);
  if (findings.length === 0) {
    return <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>No signals for the current selections.</p>;
  }
  const sorted = [...findings].sort(bySeverityThenLatest);
  const shown = showAll ? sorted : sorted.slice(0, INITIAL_ROWS);
  return (
    <>
      <div className="chart-table-wrap" style={{ maxHeight: 420 }}>
        <table className="table findings-table" aria-label="Signals to review" style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th>Severity</th>
              <th>What happened</th>
              <th>When</th>
              <th>Why it was flagged</th>
              <th>Where</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((finding) => {
              const where = `${sessionTitle(finding.sessionKey)}${finding.turnIndex !== undefined ? ` · turn ${finding.turnIndex}` : ""}`;
              return (
                <tr key={finding.key}>
                  <td>
                    <span className={`severity-tag severity-tag--${finding.severity}`}>{SEVERITY_LABELS[finding.severity]}</span>
                  </td>
                  <td>
                    <div>{finding.title}</div>
                    <div className="text-muted" style={{ fontSize: 11 }}>
                      {FINDING_KIND_LABELS[finding.kind]} · {findingCategoryLabel(finding.category)}
                    </div>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{finding.at ? formatWhen(finding.at) : "—"}</td>
                  <td>
                    <div>{finding.why}</div>
                    {finding.evidence && (
                      <code className="mono findings-evidence" title={finding.evidence}>
                        {finding.evidence}
                      </code>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost truncate"
                      style={{ maxWidth: 220, textAlign: "left" }}
                      onClick={() => onSelectSession(finding.sessionKey)}
                    >
                      {where}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!showAll && sorted.length > INITIAL_ROWS && (
        <button type="button" className="btn btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => setShowAll(true)}>
          Show all {sorted.length}
        </button>
      )}
    </>
  );
}
