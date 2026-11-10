// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { AI_CREDIT_CONVERSION_NOTE } from "@agent-cost-analyzer/domain";
import type {
  BasisCoverage,
  CostBasisTotals,
  CostComparison,
  CostComparisonRow,
  CostPoint,
  CostSeries,
  CostTotal,
  CostVariance,
  ProjectCost,
  VarianceCurrency,
  VarianceModel,
} from "@agent-cost-analyzer/domain";
import { NO_COST } from "./fixtures.js";

// Fixtures for the Increment 2 view models (U9 to U11): invented figures.

export function costTotal(credits: number | null, knownTurns: number, turns: number, overrides: Partial<CostTotal> = {}): CostTotal {
  return {
    turns,
    knownTurns,
    amounts: credits === null ? [] : [{ currency: "AI_CREDITS", amount: credits, knownTurns }],
    usd: credits === null ? null : credits * 0.01,
    estimated: false,
    apiEquivalentTurns: 0,
    ...overrides,
  };
}

export function usdTotal(usd: number | null, knownTurns: number, turns: number): CostTotal {
  return { turns, knownTurns, amounts: usd === null ? [] : [{ currency: "USD", amount: usd, knownTurns }], usd, estimated: false, apiEquivalentTurns: 0 };
}

export function coverage(known: number, turns: number): BasisCoverage {
  const part = { turns, knownTurns: known };
  return { preferred: part, billed: part, reported: { turns, knownTurns: 0 }, priced: part };
}

export function basisTotals(overrides: Partial<CostBasisTotals> = {}): CostBasisTotals {
  return { ...NO_COST, ...overrides };
}

export function point(period: string, start: string, end: string, total: CostTotal, cumulative: CostTotal): CostPoint {
  return { period, start, end, sessions: total.turns === 0 ? 0 : 2, turns: total.turns, cost: total, cumulative, coverage: coverage(total.knownTurns, total.turns) };
}

const provider = { id: "copilot", label: "Copilot Chat", available: true, sessionCount: 12, truncated: false };

export function costSeries(overrides: Partial<CostSeries> = {}): CostSeries {
  const october = costTotal(100, 38, 40);
  const november = costTotal(null, 0, 6);
  return {
    generatedAt: "2026-11-10T12:00:00Z",
    since: "2026-10-01",
    until: "2026-11-09",
    basis: "preferred",
    pricing: "as-of-use",
    currency: "native",
    conversion: AI_CREDIT_CONVERSION_NOTE,
    bucket: "month",
    groupBy: "repository",
    ids: ["github.com/acme/widgets"],
    providers: [provider],
    sessions: 9,
    turns: 46,
    undatedTurns: 2,
    total: costTotal(100, 38, 46),
    totals: basisTotals({
      preferred: costTotal(100, 38, 46),
      billed: costTotal(90, 30, 46),
      reported: costTotal(null, 0, 46),
      priced: costTotal(110, 40, 46, { estimated: true }),
      preferredBasisTurns: { billed: 30, reported: 0, priced: 8, unknown: 8 },
    }),
    points: [point("2026-10", "2026-10-01", "2026-10-31", october, october), point("2026-11", "2026-11-01", "2026-11-30", november, october)],
    series: [{ key: "github.com/acme/widgets", label: "widgets", sessions: 9, turns: 46, total: costTotal(100, 38, 46), coverage: coverage(38, 46), points: [] }],
    byVendor: [
      {
        key: "anthropic",
        label: "Anthropic",
        sessions: 6,
        turns: 30,
        cost: costTotal(70, 28, 30),
        coverage: coverage(28, 30),
        models: [{ key: "claude-sonnet-5.5", label: "claude-sonnet-5.5", sessions: 6, turns: 30, cost: costTotal(70, 28, 30), coverage: coverage(28, 30) }],
      },
      { key: null, label: "Unknown vendor", reason: "model not in the price book", sessions: 1, turns: 4, cost: costTotal(null, 0, 4), coverage: coverage(0, 4), models: [] },
    ],
    priceChanges: [
      {
        kind: "documented",
        date: "2026-10-15",
        channel: "github-copilot",
        modelId: "claude-sonnet-5.5",
        fromVersionId: "v1",
        toVersionId: "v2",
        changes: [
          { tier: 0, tokenType: "input", fromUsdPerM: 3, toUsdPerM: 4, percent: 33.33 },
          { tier: 0, tokenType: "cacheWrite", fromUsdPerM: null, toUsdPerM: 5, percent: null },
        ],
        sourceIds: ["s1"],
      },
    ],
    observedChanges: [
      {
        kind: "observed",
        date: "2026-10-26",
        channel: "github-copilot",
        modelId: "gpt-6.1-sol",
        direction: "above",
        percent: 0.12,
        weeks: [
          { period: "2026-W44", start: "2026-10-26", end: "2026-11-01", turns: 30, billedAiCredits: 11.2, pricedAiCredits: 10, ratio: 1.12 },
          { period: "2026-W45", start: "2026-11-02", end: "2026-11-08", turns: 25, billedAiCredits: 11.3, pricedAiCredits: 10, ratio: 1.13 },
        ],
        priceVersionIds: ["v1"],
        confidence: "inferred",
      },
    ],
    ...overrides,
  };
}

export function projectCost(overrides: Partial<ProjectCost> = {}): ProjectCost {
  const known = { value: 1000, knownTurns: 46, turns: 46, estimated: false };
  return {
    ...costSeries({ groupBy: "project", ids: ["p1"], series: [{ key: "p1", label: "Acme platform", sessions: 9, turns: 46, total: costTotal(100, 38, 46), coverage: coverage(38, 46), points: [] }] }),
    project: { id: "p1", name: "Acme platform" },
    byRepository: [{ key: "github.com/acme/widgets", label: "widgets", sessions: 9, turns: 46, cost: costTotal(100, 38, 46), coverage: coverage(38, 46) }],
    byTokenType: [
      {
        model: "claude-sonnet-5.5",
        vendorId: "anthropic",
        turns: 46,
        uncachedInput: known,
        cacheWrite: { ...known, value: null, knownTurns: 0 },
        cacheRead: { ...known, value: 250_000, knownTurns: 20 },
        reasoning: known,
        output: { ...known, value: 64_000, estimated: true },
      },
    ],
    topSessions: [
      {
        providerId: "copilot",
        sessionId: "7f3a9c2e",
        title: "Refactor provider registry",
        model: "claude-sonnet-5.5",
        startedAt: "2026-10-27T14:00:00Z",
        turns: 42,
        cost: costTotal(18.42, 40, 42),
        coverage: coverage(40, 42),
      },
    ],
    ...overrides,
  };
}

const change = (current: number | null, previous: number | null, ratio?: number | null) => ({
  currency: "AI_CREDITS" as const,
  current,
  previous,
  absolute: current === null || previous === null ? null : current - previous,
  ratio: ratio !== undefined ? ratio : current === null || previous === null || previous === 0 ? null : (current - previous) / previous,
});

export { change as comparisonChange };

export function comparisonRow(overrides: Partial<CostComparisonRow> = {}): CostComparisonRow {
  return {
    key: "github.com/acme/widgets",
    label: "widgets",
    sessions: 9,
    turns: 46,
    activeDays: 5,
    total: costTotal(100, 38, 46),
    coverage: coverage(38, 46),
    previous: { sessions: 8, turns: 40, total: costTotal(80, 40, 40), coverage: coverage(40, 40) },
    change: [change(100, 80)],
    perSession: [{ currency: "AI_CREDITS", amount: 11.11 }],
    perActiveDay: [{ currency: "AI_CREDITS", amount: 20 }],
    perTurn: [{ currency: "AI_CREDITS", amount: 2.17 }],
    share: [{ currency: "AI_CREDITS", share: 0.625 }],
    cacheHitRatio: 0.81,
    outputShare: 0.04,
    ...overrides,
  };
}

export function costComparison(overrides: Partial<CostComparison> = {}): CostComparison {
  return {
    generatedAt: "2026-11-10T12:00:00Z",
    since: "2026-11-01",
    until: "2026-11-09",
    comparePeriod: "previous",
    previousSince: "2026-10-23",
    previousUntil: "2026-10-31",
    groupBy: "repository",
    basis: "preferred",
    pricing: "as-of-use",
    currency: "native",
    conversion: AI_CREDIT_CONVERSION_NOTE,
    providers: [provider],
    undatedTurns: 0,
    total: costTotal(160, 70, 76),
    rows: [
      comparisonRow({ key: "r-small", label: "tools", total: costTotal(60, 30, 30), share: [{ currency: "AI_CREDITS", share: 0.375 }] }),
      comparisonRow(),
    ],
    ...overrides,
  };
}

export function varianceModel(overrides: Partial<VarianceModel> = {}): VarianceModel {
  return {
    model: "claude-sonnet-5.5",
    vendorId: "anthropic",
    costA: 60,
    costB: 100,
    change: 40,
    usage: 30,
    price: 10,
    priceVersionIdsA: ["v1"],
    priceVersionIdsB: ["v2"],
    byTokenType: [
      { tokenType: "uncachedInput", tokensA: 1_000_000, tokensB: 1_500_000, unitPriceA: 3, unitPriceB: 4, costA: 30, costB: 60, usage: 15, price: 15 },
      { tokenType: "cacheWrite", tokensA: 0, tokensB: 200_000, unitPriceA: null, unitPriceB: 5, costA: 0, costB: 1, usage: 0, price: 0 },
    ],
    ...overrides,
  };
}

export function varianceCurrency(overrides: Partial<VarianceCurrency> = {}): VarianceCurrency {
  return {
    currency: "AI_CREDITS",
    costA: 80,
    costB: 120,
    change: 40,
    usage: 25,
    price: 10,
    mix: 5,
    turnsA: 40,
    turnsB: 46,
    byTokenType: [{ tokenType: "uncachedInput", tokensA: 1_000_000, tokensB: 1_500_000, averagePriceA: 3, usage: 25, mix: 5, price: 10 }],
    models: [varianceModel(), varianceModel({ model: "gpt-6.1-sol", vendorId: "openai", costA: 20, costB: 20, change: 0, usage: 0, price: 0, byTokenType: [] })],
    ...overrides,
  };
}

export function costVariance(overrides: Partial<CostVariance> = {}): CostVariance {
  return {
    generatedAt: "2026-11-10T12:00:00Z",
    groupBy: "repository",
    id: "github.com/acme/widgets",
    label: "widgets",
    periodA: { label: "2026-09", since: "2026-09-01", until: "2026-09-30" },
    periodB: { label: "2026-10", since: "2026-10-01", until: "2026-10-31" },
    basis: "priced",
    pricing: "as-of-use",
    currency: "native",
    conversion: AI_CREDIT_CONVERSION_NOTE,
    providers: [provider],
    currencies: [varianceCurrency()],
    notExplained: { periodA: { turns: 0 }, periodB: { turns: 3, reasons: ["no price for mystery-model"] } },
    priceChanges: costSeries().priceChanges,
    ...overrides,
  };
}
