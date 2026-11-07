// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { USD_PER_AI_CREDIT, type CostTotal, type Currency } from "@agent-cost-analyzer/domain";
import { formatUsd } from "../ai-credits-usd.js";

// Phase 15 step 15.9 (plan §11.6 Content, D2): how the cost tabs write
// figures. Units always; AI Credits with 2 decimals; unknown written as
// "unknown", never as 0 (architecture.md constraint 6). Every figure is
// shown in one unit the person picks; the other is converted at GitHub's
// documented 1 AI Credit = $0.01, and the view says so.

export type DisplayUnit = Currency;

export const UNKNOWN = "unknown";
// A typographic minus, so a decrease reads as one at a glance.
const MINUS = "−";

export function unitLabel(unit: DisplayUnit): string {
  return unit === "AI_CREDITS" ? "AI Credits" : "USD";
}

// A total in the shown unit; null when nothing in it is known.
export function amountIn(total: Pick<CostTotal, "usd">, unit: DisplayUnit): number | null {
  if (total.usd === null) return null;
  return unit === "USD" ? total.usd : total.usd / USD_PER_AI_CREDIT;
}

// A USD amount (a per-currency USD figure) in the shown unit.
export function usdIn(usd: number | null, unit: DisplayUnit): number | null {
  return amountIn({ usd }, unit);
}

const grouped2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatAmount(value: number | null, unit: DisplayUnit): string {
  if (value === null) return UNKNOWN;
  if (unit === "AI_CREDITS") return grouped2.format(value);
  return value >= 1 ? `$${grouped2.format(value)}` : formatUsd(value);
}

// An axis tick: the same unit, fewer digits.
export function formatTick(value: number, unit: DisplayUnit): string {
  let text: string;
  if (value >= 10_000) text = `${Math.round(value / 1000)}K`;
  else if (value >= 100 || value === 0) text = String(Math.round(value));
  else if (value >= 1) text = String(Math.round(value * 10) / 10);
  else text = String(Number(value.toPrecision(2)));
  return unit === "USD" ? `$${text}` : text;
}

export function coverageNote(coverage: { turns: number; knownTurns: number }): string {
  if (coverage.turns === 0) return "no turns";
  if (coverage.knownTurns === coverage.turns) return `all ${coverage.turns} turns known`;
  return `${coverage.knownTurns} of ${coverage.turns} turns known`;
}

export function coverageRatio(coverage: { turns: number; knownTurns: number }): number | null {
  return coverage.turns === 0 ? null : coverage.knownTurns / coverage.turns;
}

export function formatPercent(ratio: number | null, digits = 1): string {
  return ratio === null ? UNKNOWN : `${(ratio * 100).toFixed(digits)}%`;
}

export function formatChange(ratio: number | null): string {
  if (ratio === null) return UNKNOWN;
  const text = `${Math.abs(ratio * 100).toFixed(1)}%`;
  if (Number(text.slice(0, -1)) === 0) return "0.0%";
  return ratio > 0 ? `+${text}` : `${MINUS}${text}`;
}

// USD per 1M tokens, as the price book states it.
export function formatUnitPrice(usdPerM: number | null): string {
  return usdPerM === null ? "none" : formatUsd(usdPerM);
}

// D2: say so whenever a figure in another currency was converted.
export function conversionNote(nativeCurrencies: readonly Currency[], unit: DisplayUnit): string | undefined {
  const converted = nativeCurrencies.filter((currency) => currency !== unit);
  if (converted.length === 0) return undefined;
  return `${unit === "AI_CREDITS" ? "USD figures" : "AI Credits"} converted at 1 AI Credit = $0.01.`;
}
