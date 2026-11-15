// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { Tag } from "@agent-cost-analyzer/web/ui/Tag";
import { useId } from "react";
import type { Ref } from "react";
import type { SavingsRowView, SessionButtonView } from "../../view-models/savings.js";
import { isPlainSessionId } from "../cost-rollup/AskAboutSession.js";
import { SimulatedTag } from "../replay/ReplayDetail.js";
import { UserPriceTag } from "../UserPriceTag.js";

// One row of a ranked list or of the Simulated section (boards Savings.dc.html).
// The row is one button that opens its detail in place (D16). Everything
// logged (subject, action, reasons) is plain text. The bar is decoration:
// solid to the low end, hatched to the high end; the words carry the meaning.

function Chevron({ open }: { open: boolean }) {
  return (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={open ? "sv-chevron sv-chevron-open" : "sv-chevron"}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function SavingsRow({
  row,
  open,
  onToggle,
  focusSession,
  focusRef,
  onOpenSession,
}: {
  row: SavingsRowView;
  open: boolean;
  onToggle: () => void;
  // The session button Back returns focus to (D16), if it is in this row.
  focusSession: { providerId: string; sessionId: string } | undefined;
  focusRef: Ref<HTMLButtonElement>;
  onOpenSession: (session: SessionButtonView) => void;
}) {
  const detailId = useId();
  return (
    <li className="sv-row">
      <button type="button" className="sv-row-button" aria-expanded={open} aria-controls={detailId} onClick={onToggle}>
        {row.rank !== undefined && (
          <span className="sv-rank" aria-hidden="true">
            {row.rank}
          </span>
        )}
        <span className="sv-main">
          <span className="sv-title">{row.kindTitle}</span>
          <span className="sv-subject">
            <span className="sv-subject-text">{row.subject}</span>
            {row.inferred && (
              <Tag variant="outline" className="view-estimate">
                inferred
              </Tag>
            )}
            {row.estimate && (
              <Tag variant="outline" className="view-estimate">
                estimate
              </Tag>
            )}
            {row.simulated && <SimulatedTag />}
            <UserPriceTag ids={row.userPriceVersionIds} />
          </span>
          <span className="text-muted sv-coverage">{row.coverageText}</span>
        </span>
        <span className="sv-amount">
          <span className={row.unknownReason === undefined ? "sv-amount-text" : "sv-amount-text view-unknown"}>{row.amountText}</span>
          {row.unknownReason !== undefined && <span className="text-muted sv-reason">{row.unknownReason}</span>}
          {row.bar !== undefined && (
            <span className={row.simulated ? "sv-bar sv-bar-sim" : "sv-bar"} aria-hidden="true">
              <i className="sv-bar-sure" style={{ width: `${row.bar.solid}%` }} />
              <i className="sv-bar-maybe" style={{ left: `${row.bar.solid}%`, width: `${row.bar.hatched}%` }} />
            </span>
          )}
        </span>
        <Chevron open={open} />
      </button>
      {open && (
        <div className="sv-detail" id={detailId}>
          {row.windowText !== "" && <p className="sv-window">{row.windowText}</p>}
          {row.simulated && <p className="text-muted sv-note">A replay on another model, not a billed amount. Never ranked with the changes above.</p>}
          <dl className="sv-kv">
            {row.evidence.map((item) => (
              <div key={item.label} className="sv-kv-row">
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
            {row.simulation !== undefined && (
              <>
                <div className="sv-kv-row">
                  <dt>Self-check</dt>
                  <dd>{row.simulation.selfCheck}</dd>
                </div>
                <div className="sv-kv-row">
                  <dt>Replayed</dt>
                  <dd>{row.simulation.replayed}</dd>
                </div>
              </>
            )}
          </dl>
          <section aria-label="What to change" className="sv-block">
            <h3>What to change</h3>
            <p className="sv-action">{row.action}</p>
            <p className="text-muted sv-note">Suggestion only. Nothing is changed.</p>
          </section>
          {row.simulation?.assumptions.map((assumption) => (
            <p key={assumption.id} className="text-muted sv-note">
              <b>{assumption.id}.</b> {assumption.text}
            </p>
          ))}
          <section aria-label="Sessions" className="sv-block">
            <h3>{row.sessionsHeading}</h3>
            <ul className="sv-sessions">
              {row.sessions.map((session) => {
                const isFocus = focusSession !== undefined && focusSession.providerId === session.providerId && focusSession.sessionId === session.sessionId;
                return (
                  <li key={`${session.providerId}:${session.sessionId}`}>
                    <span className="sv-session-main">
                      <code className="sv-id">{session.sessionId}</code>
                      <span className="text-muted sv-session-date">{session.dateText}</span>
                    </span>
                    <span className="sv-session-saving">{session.savingText}</span>
                    {isPlainSessionId(session.sessionId) && (
                      <button ref={isFocus ? focusRef : undefined} type="button" className="view-link sv-open" aria-label={`${session.label} for session ${session.sessionId}`} onClick={() => onOpenSession(session)}>
                        {session.label}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {row.notPricedText !== undefined && <p className="text-muted sv-note">{row.notPricedText}</p>}
          </section>
          {row.priceVersions.length > 0 && <p className="text-muted sv-note">{`Prices: ${row.priceVersions.join(", ")}, in force on the dates of these requests.`}</p>}
        </div>
      )}
    </li>
  );
}
