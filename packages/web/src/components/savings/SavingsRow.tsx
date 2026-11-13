// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Ref } from "react";
import type { SavingsOpportunity } from "@agent-cost-analyzer/domain";
import { amountText, barSegments, coverageText, KIND_TITLES } from "../../lib/savings/savings-view.js";
import { SavingsLabel } from "./SavingsLabel.js";

// One row of a ranked list or of the Simulated section (boards Dashboard,
// Detail). Kind, subject, labels, amount, coverage and a bar, all inside one
// button that opens the detail. The bar is decoration (solid to the low end,
// hatched to the high end); the words carry the meaning.

interface SavingsRowProps {
  opportunity: SavingsOpportunity;
  // Shown for ranked rows only; null leaves the cell empty (unpriced rows are
  // unranked), undefined omits it (the Simulated section is not ranked).
  rank?: number | null;
  maxHigh: number;
  selected: boolean;
  onSelect: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}

export function SavingsRow({ opportunity, rank, maxHigh, selected, onSelect, buttonRef }: SavingsRowProps) {
  const amount = opportunity.perWeek;
  const bar = barSegments(amount, maxHigh);
  const simulated = opportunity.kind === "cheaper-model";
  return (
    <li className="savings-row" data-testid="savings-row" data-selected={selected ? "true" : undefined}>
      <button type="button" className="savings-row-button" aria-pressed={selected} onClick={onSelect} ref={buttonRef}>
        {rank !== undefined && (
          <span className="savings-rank" aria-hidden="true">
            {rank ?? ""}
          </span>
        )}
        <span className="savings-row-main">
          <span className="savings-row-title">{KIND_TITLES[opportunity.kind]}</span>
          <span className="savings-subject">
            <span className="savings-subject-text">{opportunity.subject}</span>
            {opportunity.inferred && <SavingsLabel kind="dash">inferred</SavingsLabel>}
            {opportunity.evidence.tokens?.known === true && opportunity.evidence.tokens.estimated === true && <SavingsLabel kind="dash">estimate</SavingsLabel>}
            {simulated && <SavingsLabel kind="sim">Simulated</SavingsLabel>}
          </span>
          <span className="text-muted savings-coverage">{coverageText(opportunity.coverage)}</span>
        </span>
        <span className="savings-row-amount">
          <span className={amount.known ? "savings-amount-text" : "savings-amount-text savings-amount-text--unknown"}>{amountText(amount)}</span>
          {!amount.known && <span className="text-muted">{amount.reason}</span>}
          {bar && (
            <span className={simulated ? "savings-bar savings-bar--sim" : "savings-bar"} aria-hidden="true">
              <i className="savings-bar-sure" style={{ width: `${bar.solid}%` }} />
              <i className="savings-bar-maybe" style={{ left: `${bar.solid}%`, width: `${bar.hatched}%` }} />
            </span>
          )}
        </span>
      </button>
    </li>
  );
}
