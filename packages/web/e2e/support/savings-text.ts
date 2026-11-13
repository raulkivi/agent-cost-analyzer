// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { SavingsAmount, SavingsOpportunity } from "@agent-cost-analyzer/domain";

// Phase 16 SR15: what the Savings tab must show for an API answer, written
// out here on purpose rather than imported from the tab's own formatter, so
// a spec comparing the screen to the API catches a wrong figure on either
// side. Shared by the standalone app's Playwright spec and the extension's
// wdio spec.

const GROUPING = /\B(?=(\d{3})+(?!\d))/g;

function fixed(value: number, digits: number): string {
  const [whole = "0", decimals] = value.toFixed(digits).split(".");
  return `${whole.replace(GROUPING, ",")}${decimals === undefined ? "" : `.${decimals}`}`;
}

function figure(currency: "USD" | "AI_CREDITS", value: number): string {
  return currency === "USD" ? `$${fixed(value, 2)}` : fixed(value, 1);
}

// "up to $3.20 per week", "6.2–38.4 AI Credits per week" or "Not priced".
export function expectedAmountText(amount: SavingsAmount): string {
  if (!amount.known) return "Not priced";
  const suffix = amount.currency === "AI_CREDITS" ? " AI Credits" : "";
  if (amount.label === "upper-bound") return `up to ${figure(amount.currency, amount.high)}${suffix} per week`;
  return `${figure(amount.currency, amount.low)}–${figure(amount.currency, amount.high)}${suffix} per week`;
}

const TITLES: Record<SavingsOpportunity["kind"], string> = {
  "unused-tools": "Tools loaded but never used",
  "idle-cache-expiry": "Cache lost after an idle gap",
  "unexplained-cache-break": "Cache lost with no idle gap",
  "model-switch": "Model switched mid-session",
  "failed-tool-calls": "Repeated failed tool calls",
  "cheaper-model": "A cheaper model",
};

export interface ExpectedRow {
  title: string;
  subject: string;
  amount: string;
  coverage: string;
}

export function expectedRow(opportunity: SavingsOpportunity): ExpectedRow {
  const { coverage } = opportunity;
  const gaps = coverage.notAnalysed.map((gap) => `${gap.sessions} not analysed: ${gap.reason}`);
  return {
    title: TITLES[opportunity.kind],
    subject: opportunity.subject,
    amount: expectedAmountText(opportunity.perWeek),
    coverage: [`${coverage.sessionsAnalysed} of ${coverage.sessionsInWindow} sessions`, ...gaps].join("; "),
  };
}

// The list a priced row belongs to (never converted, never added up).
export function expectedListName(opportunity: SavingsOpportunity): "AI Credits" | "US dollars" | undefined {
  if (!opportunity.perWeek.known) return undefined;
  return opportunity.perWeek.currency === "USD" ? "US dollars" : "AI Credits";
}
