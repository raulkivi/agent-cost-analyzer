// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { StatTile } from "@agent-cost-analyzer/web/ui/StatTile";
import type { AuditRollupViewModel } from "../../view-models/index.js";
import { AuditTile } from "./AuditTile.js";
import { CategoryList } from "./CategoryList.js";
import { FailedPerDayChart } from "./FailedPerDayChart.js";
import "./audit.css";

// U4 for a date range. The sessions table is display only: no row opens
// anything (owner answer Q10). Sessions whose tool calls are not recorded
// are named in the "Left out" tile and are in no figure. Commands and titles
// are logged text, shown as text and never sent to the host's model (§6).

export function AuditRollupBody({ vm }: { vm: AuditRollupViewModel }) {
  return (
    <>
      <div className="stat-tiles view-tiles">
        <AuditTile label="Tool calls" tile={vm.tiles.toolCalls} />
        <AuditTile label="Failed" tile={vm.tiles.failed} />
        <AuditTile label="Failure rate" tile={vm.tiles.failureRate} />
        {vm.leftOut !== undefined && <StatTile label="Left out" value={vm.leftOut.text} note={vm.leftOut.note} />}
      </div>

      {vm.unavailableReason !== undefined && !vm.tiles.toolCalls.known && (
        <p role="status" className="text-muted">
          No session in this range has recorded tool calls: {vm.unavailableReason}
        </p>
      )}

      {vm.daily.points.length > 0 && (
        <section className="view-section" aria-label="Failed calls per day">
          <div className="view-section-head">
            <h2>Failed calls per day</h2>
            <span className="text-muted">error, interrupted and denied</span>
          </div>
          <FailedPerDayChart daily={vm.daily} />
        </section>
      )}

      <section className="view-section" aria-label="Why calls failed">
        <div className="view-section-head">
          <h2>Why calls failed</h2>
          <span className="text-muted">{vm.categories.title}</span>
        </div>
        <CategoryList categories={vm.categories} />
      </section>

      {vm.topCommands.length > 0 && (
        <section className="view-section" aria-label="Top failing commands">
          <div className="view-section-head">
            <h2>Top failing commands</h2>
            <span className="text-muted">logged text, shown as written</span>
          </div>
          <div className="view-scroll" tabIndex={0} role="region" aria-label="Top failing commands, scrollable">
            <table className="view-table" aria-label="Top failing commands">
              <thead>
                <tr>
                  <th className="view-left">Failing command</th>
                  <th className="view-left au-col-wide">Category</th>
                  <th>Fails</th>
                  <th>Sessions</th>
                </tr>
              </thead>
              <tbody>
                {vm.topCommands.map((command, index) => (
                  <tr key={`${command.command}-${index}`}>
                    <td className="view-left view-cell-text">
                      <span className="au-command">{command.command}</span>
                      {command.category !== undefined && <span className="au-sub text-muted">{command.category}</span>}
                    </td>
                    <td className="view-left text-muted au-col-wide">{command.category ?? ""}</td>
                    <td>{command.failsText}</td>
                    <td>{command.sessionsText}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {vm.sessions.rows.length > 0 && (
        <section className="view-section" aria-label="Most failures by session">
          <div className="view-section-head">
            <h2>Most failures by session</h2>
            {vm.sessions.shownNote !== undefined && <span className="text-muted">{vm.sessions.shownNote}</span>}
          </div>
          <div className="view-scroll" tabIndex={0} role="region" aria-label="Most failures by session, scrollable">
            <table className="view-table" aria-label="Most failures by session">
              <thead>
                <tr>
                  <th className="view-left">Session</th>
                  <th>Calls</th>
                  <th>Failed</th>
                  <th>Unknown</th>
                </tr>
              </thead>
              <tbody>
                {vm.sessions.rows.map((row, index) => (
                  <tr key={`${row.title}-${index}`}>
                    <td className="view-left view-cell-text">
                      <span>{row.title}</span>
                      {row.startedText !== undefined && <span className="au-when text-muted">{row.startedText}</span>}
                    </td>
                    <td>{row.callsText}</td>
                    <td>{row.failedText}</td>
                    <td>{row.unknownText}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
