// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { SessionAuditViewModel } from "../../view-models/index.js";
import { AuditTile } from "./AuditTile.js";
import { CategoryList } from "./CategoryList.js";
import "./audit.css";

// U4 for one session. Commands and tool names are logged text: rendered as
// text in the table, never sent to the host's model (§6).

export function SessionAuditBody({ vm }: { vm: SessionAuditViewModel }) {
  const { recovery } = vm;
  return (
    <>
      <div className="stat-tiles view-tiles">
        <AuditTile label="Tool calls" tile={vm.tiles.toolCalls} />
        <AuditTile label="Failed" tile={vm.tiles.failed} />
        <AuditTile label="Failure rate" tile={vm.tiles.failureRate} />
        <AuditTile label="Outcome unknown" tile={vm.tiles.unknown} />
      </div>

      {vm.unavailableReason !== undefined ? (
        <p role="status" className="text-muted">
          Tool calls are not recorded for this session: {vm.unavailableReason}
        </p>
      ) : (
        <>
          <section className="view-section" aria-label="Why calls failed">
            <div className="view-section-head">
              <h2>Why calls failed</h2>
              <span className="text-muted">{vm.categories.title}</span>
            </div>
            <CategoryList categories={vm.categories} />
          </section>

          <section className="view-section" aria-label="Recovery cost">
            <div className="view-section-head">
              <h2>Recovery cost</h2>
              <span className="text-muted">{recovery.unitLabel}</span>
            </div>
            {recovery.none ? (
              <p className="text-muted">{recovery.noneText}</p>
            ) : (
              <>
                <div className="au-recovery">
                  <div className="au-fact">
                    <span className="view-label">Recovery rounds</span>
                    <b>{recovery.rounds.text}</b>
                    <span className="au-fact-note text-muted">{recovery.rounds.note}</span>
                  </div>
                  <div className="au-fact">
                    <span className="view-label">Affected turns</span>
                    <b>{recovery.affectedTurns.text}</b>
                    <span className="au-fact-note text-muted">{recovery.affectedTurns.note}</span>
                  </div>
                  <div className="au-fact">
                    <span className="view-label">Tokens in affected turns</span>
                    <b className={recovery.tokens.known ? undefined : "view-unknown"}>{recovery.tokens.text}</b>
                    <span className="au-fact-note text-muted">{recovery.tokensNote}</span>
                  </div>
                </div>
                <p className="au-note text-muted">{recovery.caveat}</p>
              </>
            )}
          </section>

          {vm.retries.length > 0 && (
            <section className="view-section" aria-label="Retried commands">
              <div className="view-section-head">
                <h2>Commands that were retried</h2>
                <span className="text-muted">logged text, shown as written</span>
              </div>
              <div className="view-scroll" tabIndex={0} role="region" aria-label="Retried commands, scrollable">
                <table className="view-table" aria-label="Commands that were retried">
                  <thead>
                    <tr>
                      <th className="view-left">Command</th>
                      <th>Tries</th>
                      <th className="view-left">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vm.retries.map((retry, index) => (
                      <tr key={`${retry.command}-${index}`}>
                        <td className="view-left view-cell-text">
                          <span className="au-command">{retry.command}</span>
                        </td>
                        <td>{retry.triesText}</td>
                        <td className="view-left view-cell-text">{retry.resultText}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="view-section" aria-label="By tool">
            <div className="view-section-head">
              <h2>By tool</h2>
            </div>
            <div className="view-scroll" tabIndex={0} role="region" aria-label="By tool, scrollable">
              <table className="view-table" aria-label="Tool calls by tool">
                <thead>
                  <tr>
                    <th className="view-left">Tool</th>
                    <th>Calls</th>
                    <th>Failed</th>
                  </tr>
                </thead>
                <tbody>
                  {vm.byTool.map((tool) => (
                    <tr key={tool.name}>
                      <td className="view-left view-cell-text">
                        <span className="au-command">{tool.name}</span>
                      </td>
                      <td>{tool.callsText}</td>
                      <td>{tool.failedText}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
