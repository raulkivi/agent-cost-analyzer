// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { formatAmount } from "@agent-cost-analyzer/web/lib/cost/cost-format";
import { costInCurrency } from "@agent-cost-analyzer/domain";
import type { CostBasisChoice, CostCurrencyChoice, CostTotal, Currency } from "@agent-cost-analyzer/domain";
import { MINUS, UNKNOWN_TEXT, coverageNote, formatCount } from "./format.js";

// Money figures for the cost-analysis views (docs/plans/mcp-apps.md §4.5):
// every figure names its basis and its currency, and currencies stay apart
// unless the result is in USD. Pure.
//
// Amounts come from packages/web `lib/cost/cost-format` (A17). The unit
// price, the "Unknown" text and the coverage note stay local: web writes
// "unknown", has no "/ 1M" suffix and words coverage differently.

export interface MoneyView {
  text: string; // "142.60 AI Credits", "$12.40" or "Unknown"
  amount: number | null; // for charts; null = unknown (a gap, never 0)
  currency: Currency | null; // null only for an unknown figure in a native view
  basis: CostBasisChoice;
  basisText: string;
  known: boolean;
  estimate: boolean;
  coverageNote?: string;
  unknownNote?: string;
}

export function formatMoney(value: number, currency: Currency): string {
  const amount = formatAmount(value, currency);
  return currency === "USD" ? amount : `${amount} AI Credits`;
}

// "+12.50 AI Credits", "−$3.00"; zero carries no sign.
export function formatSignedMoney(value: number, currency: Currency): string {
  const text = formatMoney(Math.abs(value), currency);
  if (value === 0) return text;
  return value > 0 ? `+${text}` : `${MINUS}${text}`;
}

// A unit price per 1M tokens, in the currency's unit.
export function formatUnitPrice(value: number | null, currency: Currency): string {
  return value === null ? "none" : `${formatMoney(value, currency)} / 1M`;
}

export function basisText(basis: CostBasisChoice): string {
  return basis === "preferred" ? "preferred (billed, else reported, else priced)" : basis;
}

function unknownView(basis: CostBasisChoice, currency: CostCurrencyChoice, note?: string): MoneyView {
  return {
    text: UNKNOWN_TEXT,
    amount: null,
    currency: currency === "usd" ? "USD" : null,
    basis,
    basisText: basisText(basis),
    known: false,
    estimate: false,
    ...(note === undefined ? {} : { unknownNote: note }),
  };
}

// One view per currency present. A total with nothing known is one Unknown
// view with the reason, never 0.
export function moneyViews(total: CostTotal, basis: CostBasisChoice, currency: CostCurrencyChoice): MoneyView[] {
  const converted = costInCurrency(total, currency);
  if (converted.amounts.length === 0) {
    const note = converted.turns === 0 ? "no turns" : `no ${basis} figure for ${converted.turns === 1 ? "the turn" : `any of ${formatCount(converted.turns)} turns`}`;
    return [unknownView(basis, currency, note)];
  }
  return converted.amounts.map((entry): MoneyView => {
    const note = coverageNote(entry.knownTurns, converted.turns);
    return {
      text: formatMoney(entry.amount, entry.currency),
      amount: entry.amount,
      currency: entry.currency,
      basis,
      basisText: basisText(basis),
      known: true,
      estimate: converted.estimated,
      ...(note === undefined ? {} : { coverageNote: note }),
    };
  });
}

// Per-currency measures (cost per session, per turn ...): no coverage of
// their own; empty means nothing was known.
export function perCurrencyViews(items: readonly { currency: Currency; amount: number }[], basis: CostBasisChoice, currency: CostCurrencyChoice): MoneyView[] {
  if (items.length === 0) return [unknownView(basis, currency)];
  return items.map((item): MoneyView => ({
    text: formatMoney(item.amount, item.currency),
    amount: item.amount,
    currency: item.currency,
    basis,
    basisText: basisText(basis),
    known: true,
    estimate: false,
  }));
}
