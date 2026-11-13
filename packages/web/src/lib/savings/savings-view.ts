// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import {
  savingsActionText,
  type Currency,
  type SavingsAmount,
  type SavingsCoverage,
  type SavingsOpportunity,
  type SavingsOpportunityKind,
} from "@agent-cost-analyzer/domain";

// Phase 16 SR14 (docs/plans/savings-report.md §5.3, §7): the words and numbers
// of the Savings tab. The labels ("up to", range, "Not priced") are built here
// from the amount, never in CSS, so a test can assert them (§7).

export const KIND_TITLES: Record<SavingsOpportunityKind, string> = {
  "unused-tools": "Tools loaded but never used",
  "idle-cache-expiry": "Cache lost after an idle gap",
  "unexplained-cache-break": "Cache lost with no idle gap",
  "model-switch": "Model switched mid-session",
  "failed-tool-calls": "Repeated failed tool calls",
  "cheaper-model": "A cheaper model",
};

export const CURRENCY_TITLES: Record<Currency, string> = { AI_CREDITS: "AI Credits", USD: "US dollars" };

const GROUPED = (fractionDigits: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });
const ONE_DECIMAL = GROUPED(1);
const TWO_DECIMALS = GROUPED(2);

function figure(currency: Currency, value: number): string {
  return currency === "USD" ? `$${TWO_DECIMALS.format(value)}` : ONE_DECIMAL.format(value);
}

function unit(currency: Currency): string {
  return currency === "AI_CREDITS" ? " AI Credits" : "";
}

function span(amount: Extract<SavingsAmount, { known: true }>, low = amount.low, high = amount.high): string {
  return `${figure(amount.currency, low)}–${figure(amount.currency, high)}${unit(amount.currency)}`;
}

// "6.2–38.4 AI Credits per week", "up to $3.20 per week", or "Not priced".
export function amountText(amount: SavingsAmount, per = "per week"): string {
  if (!amount.known) return "Not priced";
  if (amount.label === "upper-bound") return `up to ${figure(amount.currency, amount.high)}${unit(amount.currency)} ${per}`;
  return `${span(amount)} ${per}`;
}

// The amount over the whole window, for the detail.
export function windowAmountText(amount: SavingsAmount, days: number): string {
  if (!amount.known) return "";
  if (amount.label === "upper-bound") {
    return `No lower bound is claimed. Over the ${days} days: up to ${figure(amount.currency, amount.high)}${unit(amount.currency)}.`;
  }
  return `Over the ${days} days: ${span(amount)}.`;
}

// A Simulated saving is a replay of named sessions, so the detail also says
// what it comes to for one session (owner decision, SR11 question 6).
export function perSessionText(opportunity: SavingsOpportunity): string {
  const amount = opportunity.perWindow;
  const sessions = opportunity.evidence.sessions;
  if (!amount.known || sessions === 0) return "";
  const text = span(amount, amount.low / sessions, amount.high / sessions);
  return `${text} per session (${sessions} ${sessions === 1 ? "session" : "sessions"})`;
}

export function coverageText(coverage: SavingsCoverage): string {
  const gaps = coverage.notAnalysed.map((gap) => `${gap.sessions} not analysed: ${gap.reason}`);
  return [`${coverage.sessionsAnalysed} of ${coverage.sessionsInWindow} sessions`, ...gaps].join("; ");
}

// Percentages of the list's largest high end: solid up to the low end (likely),
// hatched from low to high (possible). Unknown has no bar.
export function barSegments(amount: SavingsAmount, maxHigh: number): { solid: number; hatched: number } | null {
  if (!amount.known || maxHigh <= 0) return null;
  const solid = (amount.low / maxHigh) * 100;
  return { solid, hatched: (amount.high / maxHigh) * 100 - solid };
}

export interface RankedRow {
  opportunity: SavingsOpportunity;
  key: string;
  // 1-based among the priced rows of the list; null when not priced.
  rank: number | null;
}

export interface CurrencyGroup {
  currency: Currency;
  rows: RankedRow[];
  maxHigh: number;
  unpriced: number;
  providerIds: string[];
}

const CURRENCY_ORDER: readonly Currency[] = ["AI_CREDITS", "USD"];
// Copilot bills in AI Credits; the other providers' savings are priced in dollars.
const AI_CREDIT_PROVIDERS: ReadonlySet<string> = new Set(["vscode", "agent-host"]);

// One list per currency; the server's order within a currency is kept (it
// ranks by the high end, unknown last). Amounts are never converted. An
// unpriced row has no currency of its own, so it joins the list of its
// provider's priced rows, else the provider's usual currency.
export function groupByCurrency(opportunities: readonly SavingsOpportunity[]): CurrencyGroup[] {
  const providerCurrency = new Map<string, Currency>();
  for (const opportunity of opportunities) {
    if (!opportunity.perWeek.known) continue;
    for (const session of opportunity.sessions) providerCurrency.set(session.providerId, opportunity.perWeek.currency);
  }
  const currencyOf = (opportunity: SavingsOpportunity): Currency => {
    if (opportunity.perWeek.known) return opportunity.perWeek.currency;
    const providerId = opportunity.sessions[0]?.providerId ?? "";
    return providerCurrency.get(providerId) ?? (AI_CREDIT_PROVIDERS.has(providerId) ? "AI_CREDITS" : "USD");
  };

  const groups = new Map<Currency, CurrencyGroup>();
  for (const opportunity of opportunities) {
    const currency = currencyOf(opportunity);
    const group = groups.get(currency) ?? { currency, rows: [], maxHigh: 0, unpriced: 0, providerIds: [] };
    groups.set(currency, group);
    group.rows.push({ opportunity, key: opportunity.key, rank: null });
    for (const session of opportunity.sessions) if (!group.providerIds.includes(session.providerId)) group.providerIds.push(session.providerId);
  }
  return CURRENCY_ORDER.flatMap((currency) => {
    const group = groups.get(currency);
    if (!group) return [];
    const priced = group.rows.filter((row) => row.opportunity.perWeek.known);
    const unpriced = group.rows.filter((row) => !row.opportunity.perWeek.known);
    priced.forEach((row, index) => (row.rank = index + 1));
    group.rows = [...priced, ...unpriced];
    group.unpriced = unpriced.length;
    group.maxHigh = Math.max(0, ...priced.map((row) => (row.opportunity.perWeek.known ? row.opportunity.perWeek.high : 0)));
    return [group];
  });
}

// The fixed template filled with the opportunity's parameters, or null when
// they do not fit (a detector bug: the detail says so rather than guessing).
export function actionTextOf(opportunity: SavingsOpportunity): string | null {
  try {
    return savingsActionText(opportunity.kind, opportunity.actionParams);
  } catch {
    return null;
  }
}

const MAX_COPY_LENGTH = 600;
// Control (Cc), format (Cf: bidi and zero-width) and separator characters, and spaces.
const CONTROL_OR_SPACE_RUN = /[\p{Cc}\p{Cf}\p{Z}\s]+/gu;

// What Copy puts on the clipboard: the fixed text folded to one line, control
// and bidi characters out, capped (threat-model §6.1, as the copied title).
export function copyableText(text: string): string {
  return text.replace(CONTROL_OR_SPACE_RUN, " ").trim().slice(0, MAX_COPY_LENGTH).trim();
}
