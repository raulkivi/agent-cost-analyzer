import {
  AI_CREDIT_CONVERSION_NOTE,
  documentedPriceChanges,
  USD_PER_AI_CREDIT,
  varianceTokenTypes,
  type CostCompareGroupBy,
  type CostCurrencyChoice,
  type CostVariance,
  type Currency,
  type PriceBookEntry,
  type PriceChangeMarker,
  type VarianceCell,
  type VarianceCurrency,
  type VarianceModel,
  type VariancePeriod,
  type VarianceTokenType,
  type VarianceTokenTypeTotal,
} from "@agent-cost-analyzer/domain";
import type { CostCube, CostCubeRow } from "./cost-cube.js";
import { groupingFor, inDateRange } from "./cube-aggregation.js";

// Phase 15 step 15.10 (docs/plans/cost-by-repository-and-project.md §8.4,
// D12): why a repository's or project's priced cost changed between two
// periods. A pure function over the cost cube (priced as of use).
//
// Per currency, a cell is one model and token type with its tokens and cost
// in each period; its unit price is cost ÷ tokens. A cell with no tokens in
// one period takes the other period's unit price, so a new or dropped model
// is all usage. Then, per cell, usage = (qB − qA) × pA and price =
// qB × (pB − pA), which add up to cB − cA. Per token type, the volume
// effect is (QB − QA) × A's average price over every model (B's when A has
// none of that type), and mix is the rest of the change after volume and
// price (D12), so the three add up to the change by construction.

export interface CostVarianceQuery {
  groupBy: CostCompareGroupBy;
  id: string;
  periodA: VariancePeriod;
  periodB: VariancePeriod;
  currency: CostCurrencyChoice;
}

type Period = "A" | "B";
const PER_M = 1_000_000;
const CURRENCY_ORDER: readonly Currency[] = ["AI_CREDITS", "USD"];

interface Explained {
  period: Period;
  row: CostCubeRow;
  currency: Currency;
  scale: number; // native → the view's currency
  versions: string[];
  parts: Record<VarianceTokenType, number>;
}

interface CellAccumulator {
  tokens: Record<Period, number>;
  cost: Record<Period, number>;
}

interface ModelAccumulator {
  vendorId: string | null;
  versions: Record<Period, Set<string>>;
  cells: Map<VarianceTokenType, CellAccumulator>;
}

const tokensOf = (row: CostCubeRow, type: VarianceTokenType): number => row[type] ?? 0;

function explain(row: CostCubeRow, period: Period, currency: CostCurrencyChoice): Explained | { reason: string } {
  const figure = row.cost.priced;
  if (!figure.known) return { reason: figure.reason };
  if (figure.byTokenType === undefined) return { reason: "The priced figure has no cost per token type." };
  const toUsd = currency === "usd" && figure.currency === "AI_CREDITS";
  return {
    period,
    row,
    currency: currency === "usd" ? "USD" : figure.currency,
    scale: toUsd ? USD_PER_AI_CREDIT : 1,
    versions: figure.priceVersionIds ?? [],
    parts: figure.byTokenType,
  };
}

const unitPrice = (cost: number, tokens: number): number | null => (tokens > 0 ? (cost / tokens) * PER_M : null);

function cellOf(type: VarianceTokenType, acc: CellAccumulator): VarianceCell {
  const unitPriceA = unitPrice(acc.cost.A, acc.tokens.A);
  const unitPriceB = unitPrice(acc.cost.B, acc.tokens.B);
  const priceA = unitPriceA ?? unitPriceB ?? 0;
  const priceB = unitPriceB ?? unitPriceA ?? 0;
  return {
    tokenType: type,
    tokensA: acc.tokens.A,
    tokensB: acc.tokens.B,
    unitPriceA,
    unitPriceB,
    costA: acc.cost.A,
    costB: acc.cost.B,
    usage: ((acc.tokens.B - acc.tokens.A) * priceA) / PER_M,
    price: (acc.tokens.B * (priceB - priceA)) / PER_M,
  };
}

function currencyRow(currency: Currency, items: readonly Explained[]): VarianceCurrency {
  const models = new Map<string, ModelAccumulator>();
  for (const item of items) {
    const model = models.get(item.row.model) ?? { vendorId: item.row.vendorId, versions: { A: new Set(), B: new Set() }, cells: new Map() };
    for (const id of item.versions) model.versions[item.period].add(id);
    for (const type of varianceTokenTypes) {
      const cell = model.cells.get(type) ?? { tokens: { A: 0, B: 0 }, cost: { A: 0, B: 0 } };
      cell.tokens[item.period] += tokensOf(item.row, type);
      cell.cost[item.period] += item.parts[type] * item.scale;
      model.cells.set(type, cell);
    }
    models.set(item.row.model, model);
  }

  const modelRows: VarianceModel[] = [...models].map(([model, acc]) => {
    const cells = varianceTokenTypes
      .map((type) => cellOf(type, acc.cells.get(type)!))
      .filter((cell) => cell.tokensA > 0 || cell.tokensB > 0 || cell.costA > 0 || cell.costB > 0);
    const costA = cells.reduce((sum, cell) => sum + cell.costA, 0);
    const costB = cells.reduce((sum, cell) => sum + cell.costB, 0);
    return {
      model,
      vendorId: acc.vendorId,
      costA,
      costB,
      change: costB - costA,
      usage: cells.reduce((sum, cell) => sum + cell.usage, 0),
      price: cells.reduce((sum, cell) => sum + cell.price, 0),
      priceVersionIdsA: [...acc.versions.A].sort(),
      priceVersionIdsB: [...acc.versions.B].sort(),
      byTokenType: cells,
    };
  });

  const byTokenType: VarianceTokenTypeTotal[] = varianceTokenTypes.flatMap((type) => {
    const cells = modelRows.flatMap((model) => model.byTokenType.filter((cell) => cell.tokenType === type));
    if (cells.length === 0) return [];
    const tokensA = cells.reduce((sum, cell) => sum + cell.tokensA, 0);
    const tokensB = cells.reduce((sum, cell) => sum + cell.tokensB, 0);
    const costA = cells.reduce((sum, cell) => sum + cell.costA, 0);
    const costB = cells.reduce((sum, cell) => sum + cell.costB, 0);
    const averagePriceA = unitPrice(costA, tokensA);
    // No tokens of this type in A: B's average price stands in (as a cell's
    // does), so new work is usage, not mix.
    const volumePrice = averagePriceA ?? unitPrice(costB, tokensB) ?? 0;
    const usage = ((tokensB - tokensA) * volumePrice) / PER_M;
    const price = cells.reduce((sum, cell) => sum + cell.price, 0);
    return [{ tokenType: type, tokensA, tokensB, averagePriceA, usage, mix: costB - costA - usage - price, price }];
  });

  const costA = modelRows.reduce((sum, model) => sum + model.costA, 0);
  const costB = modelRows.reduce((sum, model) => sum + model.costB, 0);
  const usage = byTokenType.reduce((sum, type) => sum + type.usage, 0);
  const price = byTokenType.reduce((sum, type) => sum + type.price, 0);
  return {
    currency,
    costA,
    costB,
    change: costB - costA,
    usage,
    price,
    mix: costB - costA - usage - price,
    turnsA: items.filter((item) => item.period === "A").length,
    turnsB: items.filter((item) => item.period === "B").length,
    byTokenType,
    models: modelRows.sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || a.model.localeCompare(b.model)),
  };
}

function notExplainedOf(reasons: readonly string[]) {
  const unique = [...new Set(reasons)].sort();
  return { turns: reasons.length, ...(unique.length > 0 ? { reasons: unique } : {}) };
}

function priceChangesOf(items: readonly Explained[], versions: readonly PriceBookEntry[], since: string, until: string): PriceChangeMarker[] {
  const byId = new Map(versions.map((version) => [version.id, version]));
  const pairs = new Map<string, { channel: string; modelId: string }>();
  for (const id of items.flatMap((item) => item.versions)) {
    const version = byId.get(id);
    if (version) pairs.set(JSON.stringify([version.channel, version.modelId]), { channel: version.channel, modelId: version.modelId });
  }
  return pairs.size === 0 ? [] : documentedPriceChanges(versions, { since, until, pairs: [...pairs.values()] });
}

export function buildCostVariance(cube: CostCube, query: CostVarianceQuery, priceVersions: readonly PriceBookEntry[]): CostVariance {
  const grouping = groupingFor(query.groupBy, cube);
  const selected = cube.rows.filter((row) => grouping.matches(row, query.id));
  const explained: Explained[] = [];
  const unexplained: Record<Period, string[]> = { A: [], B: [] };
  for (const [period, range] of [["A", query.periodA], ["B", query.periodB]] as const) {
    for (const row of inDateRange(selected, range.since, range.until)) {
      const result = explain(row, period, query.currency);
      if ("reason" in result) unexplained[period].push(result.reason);
      else explained.push(result);
    }
  }
  const start = query.periodA.since < query.periodB.since ? query.periodA.since : query.periodB.since;
  const end = query.periodA.until > query.periodB.until ? query.periodA.until : query.periodB.until;
  return {
    generatedAt: cube.generatedAt,
    groupBy: query.groupBy,
    id: grouping.outputKey(query.id),
    label: grouping.label(query.id),
    periodA: query.periodA,
    periodB: query.periodB,
    basis: "priced",
    pricing: "as-of-use",
    currency: query.currency,
    conversion: query.currency === "usd" ? `Every amount is in USD: AI Credits converted at ${AI_CREDIT_CONVERSION_NOTE}` : AI_CREDIT_CONVERSION_NOTE,
    providers: cube.providers,
    currencies: CURRENCY_ORDER.flatMap((currency) => {
      const items = explained.filter((item) => item.currency === currency);
      return items.length > 0 ? [currencyRow(currency, items)] : [];
    }),
    notExplained: { periodA: notExplainedOf(unexplained.A), periodB: notExplainedOf(unexplained.B) },
    priceChanges: priceChangesOf(explained, priceVersions, start, end),
  };
}
