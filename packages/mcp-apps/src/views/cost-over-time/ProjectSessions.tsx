// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Currency } from "@agent-cost-analyzer/domain";
import { useRef } from "react";
import type { TopSessionView } from "../../view-models/index.js";
import { useFocusOnMountIfLost } from "../focus.js";
import { moneyIn } from "./money-in.js";
import { unitLabelOf } from "./chart-model.js";
import "./cost-over-time.css";

// A project's most expensive sessions. A row opens that session in place
// (plan §4.5): the click hands on the ids from the row's drillDown, never the
// title, which is logged text shown here and nowhere else (§6).

export interface SessionRef {
  sessionId: string;
  providerId: string;
}

function Chevron() {
  return (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function ProjectSessions({
  sessions,
  currency,
  focusOnMount,
  onOpen,
}: {
  sessions: TopSessionView[];
  currency: Currency | null;
  focusOnMount?: SessionRef | undefined;
  onOpen: (session: SessionRef) => void;
}) {
  const returnRef = useRef<HTMLButtonElement>(null);
  useFocusOnMountIfLost(returnRef, focusOnMount !== undefined);
  if (sessions.length === 0) return <p className="text-muted">No sessions in this period.</p>;
  const isReturn = (session: TopSessionView) => focusOnMount !== undefined && session.sessionId === focusOnMount.sessionId && session.providerId === focusOnMount.providerId;
  return (
    <div className="view-scroll" tabIndex={0} role="region" aria-label="Top sessions, scrollable">
      <table className="view-table" aria-label="Top sessions by cost">
        <thead>
          <tr>
            <th className="view-left">Session</th>
            <th className="view-left ct-col-wide">Model</th>
            <th className="view-left ct-col-wide">Started</th>
            <th className="ct-col-wide">Turns</th>
            <th>{unitLabelOf(currency)}</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => {
            const cell = moneyIn(session.cost, currency);
            const { sessionId, provider } = session.drillDown.arguments;
            return (
              <tr key={`${session.providerId}:${session.sessionId}`}>
                <td className="view-left view-cell-text">
                  <button ref={isReturn(session) ? returnRef : undefined} type="button" className="view-row-button" onClick={() => onOpen({ sessionId, providerId: provider })}>
                    <Chevron />
                    <span>{session.displayOnly.title}</span>
                  </button>
                  {/* Shown instead of the Model, Started and Turns columns on a narrow host. */}
                  <span className="ct-session-sub text-muted">{[session.model, session.startedText, session.turnsText].filter((part) => part !== undefined).join(" · ")}</span>
                </td>
                <td className="view-left text-muted ct-col-wide">{session.model}</td>
                <td className="view-left text-muted ct-col-wide">{session.startedText ?? ""}</td>
                <td className="ct-col-wide">{session.turnsText}</td>
                <td>
                  <span className={cell.known ? undefined : "view-unknown"}>{cell.text}</span>
                  {cell.coverageNote !== undefined && <span className="ct-coverage text-muted">{cell.coverageNote}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
