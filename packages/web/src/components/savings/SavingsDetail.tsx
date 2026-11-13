// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useEffect, useRef, useState } from "react";
import type { SavingsOpportunity, SavingsSessionRef } from "@agent-cost-analyzer/domain";
import {
  actionTextOf,
  copyableText,
  coverageText,
  KIND_TITLES,
  perSessionText,
  amountText,
  windowAmountText,
} from "../../lib/savings/savings-view.js";
import { SavingsLabel } from "./SavingsLabel.js";

// Phase 16 SR14 (plan §5.3, §7; boards Detail and DetailMore): one opportunity
// opened. Evidence with unknown shown as Unknown, how the amount is set, the
// replay's own checks for a Simulated one, the fixed action text with Copy
// (a suggestion only: nothing here changes a setting or a file), the sessions
// with links into the session view, and the price versions on demand.

const MAX_SESSIONS_SHOWN = 5;

const FOUND_NOUN: Partial<Record<SavingsOpportunity["kind"], string>> = {
  "idle-cache-expiry": "breaks",
  "unexplained-cache-break": "breaks",
  "model-switch": "switches",
  "failed-tool-calls": "failed calls",
};

interface SavingsDetailProps {
  opportunity: SavingsOpportunity;
  days: number;
  providerLabel: (providerId: string) => string;
  openSessionLabel: string;
  onOpenSession?: (session: SavingsSessionRef) => void;
  copyToClipboard: (text: string) => Promise<void>;
  onClose: () => void;
  closeLabel: string;
  // Narrow layout: the detail replaces the list and the row that had focus,
  // so focus starts on the close button.
  focusOnOpen?: boolean;
}

function rangeExplanation(opportunity: SavingsOpportunity): string {
  const amount = opportunity.perWeek;
  if (!amount.known) return "";
  if (amount.label === "range") return "The low end is the likely figure; the high end is the most it could be.";
  if (amount.label === "upper-bound") return "An upper bound: the most it could be. No lower end is claimed.";
  return "";
}

function Evidence({ opportunity }: { opportunity: SavingsOpportunity }) {
  const { evidence } = opportunity;
  const noun = FOUND_NOUN[opportunity.kind];
  const tokens = evidence.tokens;
  return (
    <dl className="savings-kv">
      <dt>Sessions</dt>
      <dd>{evidence.sessions}</dd>
      <dt>Requests</dt>
      <dd>{evidence.requests === null ? "Unknown" : evidence.requests.toLocaleString("en-US")}</dd>
      <dt>Tokens</dt>
      <dd>
        {tokens === null ? (
          "Unknown"
        ) : tokens.known ? (
          <>
            {tokens.value.toLocaleString("en-US")}
            {opportunity.kind === "unused-tools" ? " per request" : ""}
            {tokens.estimated ? <> <SavingsLabel kind="dash">estimate</SavingsLabel></> : null}
          </>
        ) : (
          `Unknown (${tokens.reason})`
        )}
      </dd>
      {noun !== undefined && (
        <>
          <dt>Found</dt>
          <dd>{evidence.occurrences === null ? "Unknown" : `${evidence.occurrences.toLocaleString("en-US")} ${noun}`}</dd>
        </>
      )}
      <dt>Coverage</dt>
      <dd>{coverageText(opportunity.coverage)}</dd>
    </dl>
  );
}

function ReplayChecks({ opportunity }: { opportunity: SavingsOpportunity }) {
  const { simulation } = opportunity;
  if (simulation === undefined) return null;
  const { selfCheck, coverage } = simulation;
  const percent = selfCheck.requests === 0 ? 0 : Math.round((selfCheck.matching / selfCheck.requests) * 100);
  return (
    <section aria-label="Replay checks" className="savings-block">
      <h5>Replay checks</h5>
      <dl className="savings-kv">
        <dt>Self-check</dt>
        <dd>
          {selfCheck.passed ? "passed" : "did not pass"}: the replay on the session&apos;s own model matches the log for {selfCheck.matching} of {selfCheck.requests} requests ({percent}%)
        </dd>
        <dt>Coverage</dt>
        <dd>
          replayed {coverage.replayedRequests} of {coverage.requests} requests; {coverage.replayedTurns} of {coverage.turns} turns
        </dd>
      </dl>
      {simulation.assumptions.map((assumption) => (
        <p key={assumption.id} className="savings-assumption">
          <strong>{assumption.id}.</strong> {assumption.text}
        </p>
      ))}
    </section>
  );
}

function ActionBlock({ opportunity, copyToClipboard }: { opportunity: SavingsOpportunity; copyToClipboard: (text: string) => Promise<void> }) {
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const text = actionTextOf(opportunity);
  return (
    <section aria-label="What to change" className="savings-block">
      <h5>What to change</h5>
      {text === null ? (
        <p>No action text is available for this row.</p>
      ) : (
        <>
          <p className="savings-action">{text}</p>
          <div className="savings-action-bar">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                copyToClipboard(copyableText(text)).then(
                  () => setCopy("copied"),
                  () => setCopy("failed"),
                );
              }}
            >
              Copy text
            </button>
            <span className="text-muted">Suggestion only. This app does not change settings or files.</span>
          </div>
          <div role="status" aria-live="polite" className="savings-copy-status">
            {copy === "copied" ? "Copied" : copy === "failed" ? "Copy failed: select the text above by hand." : ""}
          </div>
        </>
      )}
    </section>
  );
}

export function SavingsDetail({ opportunity, days, providerLabel, openSessionLabel, onOpenSession, copyToClipboard, onClose, closeLabel, focusOnOpen = false }: SavingsDetailProps) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusOnOpen) closeButton.current?.focus();
  }, [focusOnOpen]);
  const simulated = opportunity.kind === "cheaper-model";
  const providers = [...new Set(opportunity.sessions.map((session) => providerLabel(session.providerId)))];
  const versions = [
    ...new Set([opportunity.perWeek, opportunity.perWindow].flatMap((amount) => (amount.known ? amount.priceVersionIds : []))),
  ];
  const shown = opportunity.sessions.slice(0, MAX_SESSIONS_SHOWN);
  const more = opportunity.sessions.length - shown.length;
  const windowText = windowAmountText(opportunity.perWindow, days);

  return (
    <section aria-label="Savings detail" className="savings-detail" data-testid="savings-detail">
      <button type="button" className="btn btn-secondary savings-close" onClick={onClose} ref={closeButton}>
        {closeLabel}
      </button>
      <h4 className="savings-detail-title">
        {KIND_TITLES[opportunity.kind]}
      </h4>
      <div className="savings-subject-line">
        <span className="savings-subject">{opportunity.subject}</span>
        {opportunity.inferred && <SavingsLabel kind="dash">inferred</SavingsLabel>}
        {simulated && <SavingsLabel kind="sim">Simulated</SavingsLabel>}
        {providers.length > 0 && <span className="text-muted">{providers.join(", ")}</span>}
      </div>

      <p className="savings-amount">{amountText(opportunity.perWeek)}</p>
      {simulated && <p>{perSessionText(opportunity)}</p>}
      {windowText !== "" && <p>{windowText}</p>}
      <p className="text-muted">
        {simulated
          ? "Simulated: a replay on another model, not a billed amount."
          : "Priced from the price book: what the same tokens would cost another way. It cannot be billed."}
      </p>
      {simulated ? (
        <p className="text-muted">A Simulated saving is a replay of the recorded request trace on another model, priced at list price. It is never ranked with the changes above.</p>
      ) : (
        <p className="text-muted">{rangeExplanation(opportunity)}</p>
      )}

      <section aria-label="Evidence" className="savings-block">
        <h5>Evidence</h5>
        <Evidence opportunity={opportunity} />
        {opportunity.inferred && <p className="text-muted">The group is read from names in the log, so it is a guess.</p>}
      </section>

      <ReplayChecks opportunity={opportunity} />
      <ActionBlock opportunity={opportunity} copyToClipboard={copyToClipboard} />

      <section aria-label="Sessions" className="savings-block">
        <h5>Sessions</h5>
        <ul className="savings-sessions">
          {shown.map((session) => (
            <li key={`${session.providerId}/${session.sessionId}`}>
              <span className="mono">{session.sessionId}</span>
              {onOpenSession && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  aria-label={`${openSessionLabel}: ${session.sessionId}`}
                  onClick={() => onOpenSession(session)}
                >
                  {openSessionLabel}
                </button>
              )}
            </li>
          ))}
        </ul>
        {more > 0 && <p className="text-muted">and {more} more</p>}
      </section>

      {versions.length > 0 && (
        <details className="savings-versions">
          <summary>Price versions ({versions.length})</summary>
          <ul>
            {versions.map((id) => (
              <li key={id}>
                <span className="mono">{id}</span>, in force on the dates of these requests
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
