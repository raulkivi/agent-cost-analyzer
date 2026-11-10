// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { Tag } from "@agent-cost-analyzer/web/ui/Tag";
import { useRef } from "react";
import type { TopSessionRow } from "../../view-models/index.js";
import { useFocusOnMountIfLost } from "../focus.js";
import "./cost-rollup.css";

// Top sessions by the server's ranking (AI Credits or input tokens); both
// columns stay, so the ranking column is always visible. A row opens that session in place (plan §4.3).
// The title is logged text: it is the button's label here and goes nowhere
// else (§6); the click hands the session id and provider id on.

function Chevron() {
  return (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

// `focusOnMount` names the session the user just came back from: its button
// takes the focus Back left behind (A14).
export function TopSessions({
  sessions,
  rankingLabel,
  providerLabels,
  focusOnMount,
  onOpen,
}: {
  sessions: TopSessionRow[];
  rankingLabel: string;
  providerLabels: ReadonlyMap<string, string>;
  focusOnMount?: { sessionId: string; providerId: string } | undefined;
  onOpen: (session: TopSessionRow) => void;
}) {
  const returnRef = useRef<HTMLButtonElement>(null);
  useFocusOnMountIfLost(returnRef, focusOnMount !== undefined);
  if (sessions.length === 0) return <p className="text-muted">No sessions in this period.</p>;
  const isReturn = (session: TopSessionRow) => focusOnMount !== undefined && session.sessionId === focusOnMount.sessionId && session.providerId === focusOnMount.providerId;
  return (
    <div className="view-scroll" tabIndex={0} role="region" aria-label="Top sessions, scrollable">
      <table className="view-table" aria-label={`Top sessions by ${rankingLabel}`}>
        <thead>
          <tr>
            <th className="view-left">Session</th>
            <th className="view-left rv-col-wide">Provider</th>
            <th className="view-left rv-col-wide">Model</th>
            <th className="rv-col-wide">Turns</th>
            <th>AI Credits</th>
            <th>Input tok.</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => {
            const provider = providerLabels.get(session.providerId) ?? session.providerId;
            return (
            <tr key={`${session.providerId}:${session.sessionId}`}>
              <td className="view-left view-cell-text">
                <button ref={isReturn(session) ? returnRef : undefined} type="button" className="view-row-button" onClick={() => onOpen(session)}>
                  <Chevron />
                  <span>{session.title}</span>
                </button>
                {/* Outside the button so its accessible name stays the title. */}
                {session.active && (
                  <Tag variant="outline" className="view-estimate rv-active-tag" title={session.activeHint}>
                    active
                  </Tag>
                )}
                {/* Shown instead of the Provider, Model and Turns columns on a narrow
                    host (cost-rollup.css), so AI Credits stays in view. */}
                <span className="rv-session-sub text-muted">{`${provider} · ${session.model} · ${session.turnsText}`}</span>
              </td>
              <td className="view-left text-muted rv-col-wide">{provider}</td>
              <td className="view-left text-muted rv-col-wide">{session.model}</td>
              <td className="rv-col-wide">{session.turnsText}</td>
              <td>
                <span className={session.aiCredits.known ? undefined : "view-unknown"}>{session.aiCredits.text}</span>
                {session.aiCredits.coverageNote !== undefined && <span className="rv-coverage text-muted">{session.aiCredits.coverageNote}</span>}
              </td>
              <td>
                <span className={session.inputTokens.known ? undefined : "view-unknown"}>{session.inputTokens.text}</span>
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
