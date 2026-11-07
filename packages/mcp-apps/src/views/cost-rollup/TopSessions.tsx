// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { TopSessionRow } from "../../view-models/index.js";
import "./cost-rollup.css";

// Top sessions by AI Credits. A row opens that session in place (plan §4.3).
// The title is logged text: it is the button's label here and goes nowhere
// else (§6); the click hands the session id and provider id on.

function Chevron() {
  return (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function TopSessions({ sessions, providerLabels, onOpen }: { sessions: TopSessionRow[]; providerLabels: ReadonlyMap<string, string>; onOpen: (session: TopSessionRow) => void }) {
  if (sessions.length === 0) return <p className="text-muted">No sessions in this period.</p>;
  return (
    <div className="view-scroll" tabIndex={0} role="region" aria-label="Top sessions, scrollable">
      <table className="view-table" aria-label="Top sessions by AI Credits">
        <thead>
          <tr>
            <th className="view-left">Session</th>
            <th className="view-left">Provider</th>
            <th className="view-left">Model</th>
            <th>Turns</th>
            <th>AI Credits</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr key={`${session.providerId}:${session.sessionId}`}>
              <td className="view-left view-cell-text">
                <button type="button" className="view-row-button" aria-label={session.title} onClick={() => onOpen(session)}>
                  <Chevron />
                  <span>{session.title}</span>
                </button>
              </td>
              <td className="view-left text-muted">{providerLabels.get(session.providerId) ?? session.providerId}</td>
              <td className="view-left text-muted">{session.model}</td>
              <td>{session.turnsText}</td>
              <td>
                <span className={session.aiCredits.known ? undefined : "view-unknown"}>{session.aiCredits.text}</span>
                {session.aiCredits.coverageNote !== undefined && <span className="rv-coverage text-muted">{session.aiCredits.coverageNote}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
