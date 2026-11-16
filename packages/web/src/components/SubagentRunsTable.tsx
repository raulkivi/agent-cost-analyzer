// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { AuditedRun } from "@agent-cost-analyzer/domain";
import { depthText } from "../lib/audit-origin.js";
import { failedCountOf, formatFailureRate } from "../lib/audit-format.js";
import { Blueprint } from "./ui/Blueprint.js";

// "Subagent runs" (step 10.20, ST2 boards): one row per run. A run the
// analyzer could not read shows an em dash and its reason, never 0 (D4). A
// run with known totals and a reason is flagged on a second line (D12).
// Labels and reasons are log text, rendered as React text only.
export function SubagentRunsTable({ runs }: { runs: readonly AuditedRun[] }) {
  return (
    <Blueprint className="audit-section">
      <div className="card-kicker">Subagent runs</div>
      <div className="table-scroll">
        <table className="table" aria-label="Subagent runs" style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th>Agent</th>
              <th>Turn</th>
              <th>Calls</th>
              <th>Failed</th>
              <th>Unknown</th>
              <th>Failure rate</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <RunRow key={run.runId} run={run} />
            ))}
          </tbody>
        </table>
      </div>
    </Blueprint>
  );
}

function RunRow({ run }: { run: AuditedRun }) {
  const depth = depthText(run.depth);
  const name = (
    <td style={{ paddingLeft: `${(run.depth - 1) * 12 + 8}px` }}>
      <span title={run.label}>{run.label}</span>
      {depth && <span className="text-muted"> {depth}</span>}
    </td>
  );
  if (run.totals === null) {
    return (
      <tr className="audit-run--unread">
        {name}
        <td>{run.turnIndex}</td>
        <td colSpan={4} className="audit-run-reason">
          <span aria-hidden="true">— </span>
          <span className="text-muted">{run.unreadReason}</span>
        </td>
      </tr>
    );
  }
  return (
    <>
      <tr>
        {name}
        <td>{run.turnIndex}</td>
        <td>{run.totals.toolCalls}</td>
        <td>{failedCountOf(run.totals)}</td>
        <td>{run.totals.unknown}</td>
        <td>{formatFailureRate(run.failureRate)}</td>
      </tr>
      {run.unreadReason && (
        <tr className="audit-run--flag">
          <td colSpan={6} className="text-muted">
            <span aria-hidden="true">⚑ </span>
            {run.unreadReason}
          </td>
        </tr>
      )}
    </>
  );
}
