// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { CostBasisChoice, CostChange, CostComparison, CostComparisonRow, CostCompareGroupBy, CostCurrencyChoice, Currency, PricingMode } from "@agent-cost-analyzer/domain";
import { NO_EARLIER_FIGURE, conversionNoteFor, pricingText, providerIssues } from "./analysis-common.js";
import { formatPercent, formatSignedPercent, periodText, pluralize, valueView } from "./format.js";
import type { MeasureView } from "./format.js";
import { basisText, formatSignedMoney, moneyViews, perCurrencyViews } from "./money.js";
import type { MoneyView } from "./money.js";

// U10, which repository or project costs the most (docs/plans/mcp-apps.md
// §2, §4.5). Pure: formats a compare_costs result. A change against a
// period with nothing known reads "no earlier figure", never a change from
// 0. A row's drill-down arguments for U9 come only from the input.

export interface ChangeView {
  currency: Currency | null; // null: nothing was known, so no currency
  text: string;
  noEarlierFigure: boolean;
  absoluteText?: string;
  percentText?: string; // only against a known, non-zero earlier figure
  direction?: "up" | "down" | "flat";
}

export interface ShareView {
  currency: Currency;
  share: number;
  text: string;
}

export interface ComparisonDrillDown {
  tool: "get_repository_cost" | "get_project_cost";
  arguments: { repository: string; since: string; until: string; basis: CostBasisChoice; pricing: PricingMode; currency: CostCurrencyChoice } | { projectId: string; since: string; until: string; basis: CostBasisChoice; pricing: PricingMode; currency: CostCurrencyChoice };
}

export interface ComparisonRowView {
  key: string;
  label: string;
  sessionsText: string;
  turnsText: string;
  activeDaysText: string;
  total: MoneyView[];
  previousTotal: MoneyView[];
  change: ChangeView[];
  perSession: MoneyView[];
  perActiveDay: MoneyView[];
  perTurn: MoneyView[];
  shares: ShareView[];
  cacheHit: MeasureView;
  outputShare: MeasureView;
  drillDown: ComparisonDrillDown;
}

export interface CostComparisonViewModel {
  groupBy: CostCompareGroupBy;
  periodText: string;
  previousPeriodText: string;
  comparePeriodText: string;
  basis: CostBasisChoice;
  basisText: string;
  pricingText: string;
  conversionNote?: string;
  undatedNote?: string;
  providerIssues: string[];
  total: MoneyView[];
  rows: ComparisonRowView[];
}

function changeView(change: CostChange): ChangeView {
  if (change.previous === null) return { currency: change.currency, text: NO_EARLIER_FIGURE, noEarlierFigure: true };
  if (change.current === null || change.absolute === null) return { currency: change.currency, text: "Unknown", noEarlierFigure: false };
  const absoluteText = formatSignedMoney(change.absolute, change.currency);
  const direction = change.absolute > 0 ? "up" : change.absolute < 0 ? "down" : "flat";
  if (change.ratio === null || !Number.isFinite(change.ratio)) return { currency: change.currency, text: absoluteText, noEarlierFigure: false, absoluteText, direction };
  const percentText = formatSignedPercent(change.ratio);
  return { currency: change.currency, text: `${absoluteText} (${percentText})`, noEarlierFigure: false, absoluteText, percentText, direction };
}

// No entry at all means the earlier period had nothing known.
function changeViews(row: CostComparisonRow): ChangeView[] {
  if (row.change.length === 0) return [{ currency: null, text: NO_EARLIER_FIGURE, noEarlierFigure: true }];
  return row.change.map(changeView);
}

function drillDown(comparison: CostComparison, key: string): ComparisonDrillDown {
  const view = { since: comparison.since, until: comparison.until, basis: comparison.basis, pricing: comparison.pricing, currency: comparison.currency };
  return comparison.groupBy === "repository"
    ? { tool: "get_repository_cost", arguments: { repository: key, ...view } }
    : { tool: "get_project_cost", arguments: { projectId: key, ...view } };
}

function rowView(row: CostComparisonRow, comparison: CostComparison): ComparisonRowView {
  const { basis, currency } = comparison;
  return {
    key: row.key,
    label: row.label,
    sessionsText: pluralize(row.sessions, "session"),
    turnsText: pluralize(row.turns, "turn"),
    activeDaysText: pluralize(row.activeDays, "active day"),
    total: moneyViews(row.total, basis, currency),
    previousTotal: moneyViews(row.previous.total, basis, currency),
    change: changeViews(row),
    perSession: perCurrencyViews(row.perSession, basis, currency),
    perActiveDay: perCurrencyViews(row.perActiveDay, basis, currency),
    perTurn: perCurrencyViews(row.perTurn, basis, currency),
    shares: row.share.map((entry): ShareView => ({ currency: entry.currency, share: entry.share, text: formatPercent(entry.share) })),
    cacheHit: valueView(row.cacheHitRatio, formatPercent),
    outputShare: valueView(row.outputShare, formatPercent),
    drillDown: drillDown(comparison, row.key),
  };
}

// Most expensive first, by the row's total in USD (the one cross-currency
// measure); rows with nothing known last, in the order they came.
function byCost(rows: readonly CostComparisonRow[]): CostComparisonRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const left = a.row.total.usd;
      const right = b.row.total.usd;
      if (left === null || right === null) return left === right ? a.index - b.index : left === null ? 1 : -1;
      return right - left || a.index - b.index;
    })
    .map((entry) => entry.row);
}

export function toCostComparisonViewModel(comparison: CostComparison): CostComparisonViewModel {
  const viewModel: CostComparisonViewModel = {
    groupBy: comparison.groupBy,
    periodText: periodText(comparison.since, comparison.until) ?? "",
    previousPeriodText: periodText(comparison.previousSince, comparison.previousUntil) ?? "",
    comparePeriodText: comparison.comparePeriod === "last-year" ? "same dates last year" : "previous period",
    basis: comparison.basis,
    basisText: basisText(comparison.basis),
    pricingText: pricingText(comparison.pricing),
    providerIssues: providerIssues(comparison.providers),
    total: moneyViews(comparison.total, comparison.basis, comparison.currency),
    rows: byCost(comparison.rows).map((row) => rowView(row, comparison)),
  };
  const conversion = conversionNoteFor(comparison.currency, comparison.conversion);
  if (conversion !== undefined) viewModel.conversionNote = conversion;
  if (comparison.undatedTurns > 0) {
    const one = comparison.undatedTurns === 1;
    viewModel.undatedNote = `${pluralize(comparison.undatedTurns, "turn")} ${one ? "has" : "have"} no date and ${one ? "is" : "are"} in neither period`;
  }
  return viewModel;
}
