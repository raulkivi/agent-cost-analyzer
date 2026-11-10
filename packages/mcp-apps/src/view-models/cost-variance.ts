// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type {
  CostCompareGroupBy,
  CostVariance,
  Currency,
  VarianceCell,
  VarianceCurrency,
  VarianceModel,
  VariancePeriod,
  VarianceTokenType,
  VarianceTokenTypeTotal,
} from "@agent-cost-analyzer/domain";
import { NO_EARLIER_FIGURE, conversionNoteFor, documentedPriceChange, pricingText, providerIssues } from "./analysis-common.js";
import type { DocumentedPriceChange } from "./analysis-common.js";
import { formatDay, formatSignedPercent, formatTokens, pluralize } from "./format.js";
import { basisText, formatMoney, formatSignedMoney, formatUnitPrice } from "./money.js";

// U11, why did the cost change (docs/plans/mcp-apps.md §2, §4.5). Pure:
// formats an explain_cost_change result. Usage, price and mix effects add
// up to the change, per currency; a period A with nothing priced is "no
// earlier figure", never a change from 0; turns that cannot be explained
// are counted with their reasons (display only). Drill-down arguments for
// get_price_changes come only from the input.

const MAX_DRILL_DOWN_MODELS = 3;

export interface PeriodView {
  label: string;
  rangeText: string;
  since: string;
  until: string;
}

export interface WaterfallStep {
  kind: "start" | "usage" | "price" | "mix" | "end";
  label: string;
  value: number; // the amount for start and end; the signed effect otherwise
  text: string;
}

export interface CellView {
  tokenText: string;
  tokensAText: string;
  tokensBText: string;
  unitPriceAText: string; // per 1M tokens, "none" when neither period has tokens
  unitPriceBText: string;
  usageText: string;
  priceText: string;
}

export interface ModelRowView {
  model: string;
  vendorId: string | null;
  costAText: string;
  costBText: string;
  changeText: string;
  usageText: string;
  priceText: string;
  priceVersionIdsA: string[];
  priceVersionIdsB: string[];
  cells: CellView[];
}

export interface TokenTypeTotalView {
  tokenText: string;
  tokensAText: string;
  tokensBText: string;
  averagePriceAText: string;
  usageText: string;
  mixText: string;
  priceText: string;
}

export interface CurrencyBlock {
  currency: Currency;
  steps: WaterfallStep[];
  noEarlierFigure: boolean; // period A has nothing priced
  changeValue: number;
  changeText: string;
  changePercentText?: string;
  byTokenType: TokenTypeTotalView[];
  models: ModelRowView[];
}

export interface NotExplainedView {
  turns: number;
  turnsText: string;
  displayOnly: { reasons: string[] }; // free text from the server: display only
}

export interface PriceDrillDown {
  tool: "get_price_changes";
  since: string;
  until: string;
  models: string[]; // largest price effect first
}

export interface CostVarianceViewModel {
  groupBy: CostCompareGroupBy;
  id: string;
  title: string;
  periodA: PeriodView;
  periodB: PeriodView;
  basisText: string;
  pricingText: string;
  conversionNote?: string;
  providerIssues: string[];
  currencies: CurrencyBlock[];
  notExplained: { periodA: NotExplainedView; periodB: NotExplainedView };
  hasNotExplained: boolean;
  priceChanges: DocumentedPriceChange[]; // the input carries documented changes only
  priceDrillDown?: PriceDrillDown;
}

const TOKEN_TYPE_TEXT: Record<VarianceTokenType, string> = {
  uncachedInput: "uncached input",
  cacheRead: "cache read",
  cacheWrite: "cache write",
  output: "output",
};

function periodView(period: VariancePeriod): PeriodView {
  const from = formatDay(period.since) ?? period.since;
  const to = formatDay(period.until) ?? period.until;
  return { label: period.label, rangeText: `${from} – ${to}`, since: period.since, until: period.until };
}

function cellView(cell: VarianceCell, currency: Currency): CellView {
  return {
    tokenText: TOKEN_TYPE_TEXT[cell.tokenType],
    tokensAText: formatTokens(cell.tokensA),
    tokensBText: formatTokens(cell.tokensB),
    unitPriceAText: formatUnitPrice(cell.unitPriceA, currency),
    unitPriceBText: formatUnitPrice(cell.unitPriceB, currency),
    usageText: formatSignedMoney(cell.usage, currency),
    priceText: formatSignedMoney(cell.price, currency),
  };
}

function modelRow(model: VarianceModel, currency: Currency): ModelRowView {
  return {
    model: model.model,
    vendorId: model.vendorId,
    costAText: formatMoney(model.costA, currency),
    costBText: formatMoney(model.costB, currency),
    changeText: formatSignedMoney(model.change, currency),
    usageText: formatSignedMoney(model.usage, currency),
    priceText: formatSignedMoney(model.price, currency),
    priceVersionIdsA: model.priceVersionIdsA,
    priceVersionIdsB: model.priceVersionIdsB,
    cells: model.byTokenType.map((cell) => cellView(cell, currency)),
  };
}

function tokenTypeTotal(total: VarianceTokenTypeTotal, currency: Currency): TokenTypeTotalView {
  return {
    tokenText: TOKEN_TYPE_TEXT[total.tokenType],
    tokensAText: formatTokens(total.tokensA),
    tokensBText: formatTokens(total.tokensB),
    averagePriceAText: formatUnitPrice(total.averagePriceA, currency),
    usageText: formatSignedMoney(total.usage, currency),
    mixText: formatSignedMoney(total.mix, currency),
    priceText: formatSignedMoney(total.price, currency),
  };
}

function currencyBlock(row: VarianceCurrency, variance: CostVariance): CurrencyBlock {
  const noEarlierFigure = row.costA === 0;
  const signed = (kind: WaterfallStep["kind"], label: string, value: number): WaterfallStep => ({ kind, label, value, text: formatSignedMoney(value, row.currency) });
  const changeAmount = formatSignedMoney(row.change, row.currency);
  const changePercentText = noEarlierFigure ? undefined : formatSignedPercent(row.change / row.costA);
  return {
    currency: row.currency,
    steps: [
      { kind: "start", label: variance.periodA.label, value: row.costA, text: noEarlierFigure ? NO_EARLIER_FIGURE : formatMoney(row.costA, row.currency) },
      signed("usage", "More or less usage", row.usage),
      signed("price", "Price changes", row.price),
      signed("mix", "Model mix", row.mix),
      { kind: "end", label: variance.periodB.label, value: row.costB, text: formatMoney(row.costB, row.currency) },
    ],
    noEarlierFigure,
    changeValue: row.change,
    changeText: noEarlierFigure ? NO_EARLIER_FIGURE : `${changeAmount} (${changePercentText})`,
    ...(changePercentText === undefined ? {} : { changePercentText }),
    byTokenType: row.byTokenType.map((total) => tokenTypeTotal(total, row.currency)),
    models: row.models.map((model) => modelRow(model, row.currency)),
  };
}

function notExplainedView(entry: { turns: number; reasons?: string[] | undefined }): NotExplainedView {
  return {
    turns: entry.turns,
    turnsText: entry.turns === 0 ? "all turns explained" : `${pluralize(entry.turns, "turn")} without a priced figure ${entry.turns === 1 ? "is" : "are"} not explained`,
    displayOnly: { reasons: entry.reasons ?? [] },
  };
}

// The models with the largest price effect in any currency, biggest first.
function largestPriceEffects(currencies: readonly VarianceCurrency[]): string[] {
  const effect = new Map<string, number>();
  for (const row of currencies) {
    for (const model of row.models) {
      effect.set(model.model, Math.max(effect.get(model.model) ?? 0, Math.abs(model.price)));
    }
  }
  return [...effect.entries()]
    .filter(([, size]) => size > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_DRILL_DOWN_MODELS)
    .map(([model]) => model);
}

export function toCostVarianceViewModel(variance: CostVariance): CostVarianceViewModel {
  const models = largestPriceEffects(variance.currencies);
  const since = variance.periodA.since < variance.periodB.since ? variance.periodA.since : variance.periodB.since;
  const until = variance.periodA.until > variance.periodB.until ? variance.periodA.until : variance.periodB.until;
  const periodA = notExplainedView(variance.notExplained.periodA);
  const periodB = notExplainedView(variance.notExplained.periodB);
  const viewModel: CostVarianceViewModel = {
    groupBy: variance.groupBy,
    id: variance.id,
    title: variance.label,
    periodA: periodView(variance.periodA),
    periodB: periodView(variance.periodB),
    basisText: basisText(variance.basis),
    pricingText: pricingText(variance.pricing),
    providerIssues: providerIssues(variance.providers),
    currencies: variance.currencies.map((row) => currencyBlock(row, variance)),
    notExplained: { periodA, periodB },
    hasNotExplained: periodA.turns > 0 || periodB.turns > 0,
    priceChanges: variance.priceChanges.map(documentedPriceChange),
  };
  const conversion = conversionNoteFor(variance.currency, variance.conversion);
  if (conversion !== undefined) viewModel.conversionNote = conversion;
  if (models.length > 0) viewModel.priceDrillDown = { tool: "get_price_changes", since, until, models };
  return viewModel;
}
