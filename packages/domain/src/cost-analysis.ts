// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { z } from "zod";
import { measureTotalSchema } from "./cost.js";
import {
  costBasisChoiceSchema,
  costBasisTotalsSchema,
  costTotalSchema,
  currencySchema,
  pricingModeSchema,
  type CostAmount,
  type CostTotal,
  type Currency,
} from "./cost-figure.js";
import { insightProviderStatusSchema } from "./insights.js";
import { isoCalendarDateSchema } from "./price-book.js";
import { priceChangeMarkerSchema } from "./price-change.js";

// Phase 15 step 15.7 (docs/plans/cost-by-repository-and-project.md §8.1–
// §8.3, §10, §10.1.1): cost over time, compare and inside a project. The
// HTTP API (GET /api/cost/timeseries, /api/cost/compare) and the MCP tools
// (get_repository_cost, get_project_cost, compare_costs) return these same
// schemas. Unknown is never 0 (constraint 6): every total carries its
// coverage, and a bucket with nothing known has `usd: null` and no amounts.
// Buckets are UTC (D6); weeks are ISO weeks.

export const costBucketSchema = z.enum(["day", "week", "month"]);
// D2: each figure in its own unit, or everything in USD at 1 AI Credit = $0.01.
export const costCurrencyChoiceSchema = z.enum(["native", "usd"]);
export const costSeriesGroupBySchema = z.enum(["repository", "project", "vendor", "model"]);
export const costCompareGroupBySchema = z.enum(["repository", "project"]);
export const comparePeriodSchema = z.enum(["previous", "last-year"]);

export type CostBucket = z.infer<typeof costBucketSchema>;
export type CostCurrencyChoice = z.infer<typeof costCurrencyChoiceSchema>;
export type CostSeriesGroupBy = z.infer<typeof costSeriesGroupBySchema>;
export type CostCompareGroupBy = z.infer<typeof costCompareGroupBySchema>;
export type ComparePeriod = z.infer<typeof comparePeriodSchema>;

const count = z.number().int().nonnegative();
const ratioSchema = z.number().min(0).max(1).nullable();

export const turnCoverageSchema = z
  .object({ turns: count, knownTurns: count })
  .refine((coverage) => coverage.knownTurns <= coverage.turns, { message: "knownTurns cannot exceed turns", path: ["knownTurns"] });

// How many turns each basis knows, whichever basis the view shows.
export const basisCoverageSchema = z.object({
  preferred: turnCoverageSchema,
  billed: turnCoverageSchema,
  reported: turnCoverageSchema,
  priced: turnCoverageSchema,
});

export type TurnCoverage = z.infer<typeof turnCoverageSchema>;
export type BasisCoverage = z.infer<typeof basisCoverageSchema>;

// What every analysis states about how its figures were chosen.
const viewShape = {
  basis: costBasisChoiceSchema,
  pricing: pricingModeSchema,
  currency: costCurrencyChoiceSchema,
  conversion: z.string(),
};

export const costPointSchema = z.object({
  period: z.string(), // "2026-10-07", "2026-W41" or "2026-10"
  start: isoCalendarDateSchema, // inclusive
  end: isoCalendarDateSchema, // inclusive
  sessions: count,
  turns: count,
  cost: costTotalSchema, // the view's basis, in the view's currency
  cumulative: costTotalSchema, // running total from the first point
  coverage: basisCoverageSchema,
});

export const costSeriesLineSchema = z.object({
  key: z.string().nullable(), // null: the Unattributed / No project / unknown bucket
  label: z.string(),
  reason: z.string().optional(),
  sessions: count,
  turns: count,
  total: costTotalSchema,
  coverage: basisCoverageSchema,
  points: z.array(costPointSchema),
});

export const costBreakdownRowSchema = z.object({
  key: z.string().nullable(),
  label: z.string(),
  reason: z.string().optional(),
  sessions: count,
  turns: count,
  cost: costTotalSchema,
  coverage: basisCoverageSchema,
});

export const vendorCostBreakdownSchema = costBreakdownRowSchema.extend({ models: z.array(costBreakdownRowSchema) });

export type CostPoint = z.infer<typeof costPointSchema>;
export type CostSeriesLine = z.infer<typeof costSeriesLineSchema>;
export type CostBreakdownRow = z.infer<typeof costBreakdownRowSchema>;
export type VendorCostBreakdown = z.infer<typeof vendorCostBreakdownSchema>;

export const costSeriesSchema = z.object({
  generatedAt: z.string(),
  since: isoCalendarDateSchema.optional(),
  until: isoCalendarDateSchema.optional(),
  ...viewShape,
  bucket: costBucketSchema,
  groupBy: costSeriesGroupBySchema.optional(),
  ids: z.array(z.string()).optional(),
  providers: z.array(insightProviderStatusSchema),
  sessions: count,
  turns: count,
  // Turns with no time of their own or their session's: in no bucket.
  undatedTurns: count,
  total: costTotalSchema, // the selection, view basis and currency
  totals: costBasisTotalsSchema, // the selection per basis, native currencies
  points: z.array(costPointSchema), // one per bucket in the range, empty buckets included
  series: z.array(costSeriesLineSchema), // one per group (with groupBy)
  byVendor: z.array(vendorCostBreakdownSchema), // vendor → model
  priceChanges: z.array(priceChangeMarkerSchema), // documented changes in the range, for the models priced
});

export type CostSeries = z.infer<typeof costSeriesSchema>;

const tokenTypeShape = {
  uncachedInput: measureTotalSchema,
  cacheWrite: measureTotalSchema,
  cacheRead: measureTotalSchema,
  reasoning: measureTotalSchema,
  output: measureTotalSchema,
};

export const projectCostSchema = costSeriesSchema.extend({
  project: z.object({ id: z.string(), name: z.string() }),
  byRepository: z.array(costBreakdownRowSchema),
  // Tokens per model by type (what prices multiply), with coverage.
  byTokenType: z.array(z.object({ model: z.string(), vendorId: z.string().nullable(), turns: count, ...tokenTypeShape })),
  topSessions: z.array(
    z.object({
      providerId: z.string(),
      sessionId: z.string(),
      title: z.string(),
      model: z.string(),
      startedAt: z.string().optional(),
      turns: count,
      cost: costTotalSchema,
      coverage: basisCoverageSchema,
    }),
  ),
});

export type ProjectCost = z.infer<typeof projectCostSchema>;

const perCurrencySchema = z.object({ currency: currencySchema, amount: z.number().nonnegative() });

export const costChangeSchema = z.object({
  currency: currencySchema,
  current: z.number().nonnegative().nullable(),
  previous: z.number().nonnegative().nullable(),
  absolute: z.number().nullable(), // current − previous; null when either is unknown
  ratio: z.number().nullable(), // absolute ÷ previous; null when previous is unknown or 0
});

export const costComparisonRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  sessions: count,
  turns: count,
  activeDays: count,
  total: costTotalSchema,
  coverage: basisCoverageSchema,
  previous: z.object({ sessions: count, turns: count, total: costTotalSchema, coverage: basisCoverageSchema }),
  change: z.array(costChangeSchema),
  perSession: z.array(perCurrencySchema),
  perActiveDay: z.array(perCurrencySchema),
  perTurn: z.array(perCurrencySchema),
  share: z.array(z.object({ currency: currencySchema, share: z.number().min(0).max(1) })), // of the compared ids' total
  cacheHitRatio: ratioSchema, // cache read ÷ input tokens
  outputShare: ratioSchema, // output ÷ (input + output) tokens
});

export const costComparisonSchema = z.object({
  generatedAt: z.string(),
  since: isoCalendarDateSchema,
  until: isoCalendarDateSchema,
  comparePeriod: comparePeriodSchema,
  previousSince: isoCalendarDateSchema,
  previousUntil: isoCalendarDateSchema,
  groupBy: costCompareGroupBySchema,
  ...viewShape,
  providers: z.array(insightProviderStatusSchema),
  undatedTurns: count,
  total: costTotalSchema, // the compared ids together, this period
  rows: z.array(costComparisonRowSchema), // in the order of `ids`
});

export type CostChange = z.infer<typeof costChangeSchema>;
export type CostComparisonRow = z.infer<typeof costComparisonRowSchema>;
export type CostComparison = z.infer<typeof costComparisonSchema>;

// ---- pure helpers (UTC calendar arithmetic, currency) ----

const DAY_MS = 86_400_000;
const toTime = (date: string): number => Date.parse(`${date}T00:00:00Z`);
const toDate = (time: number): string => new Date(time).toISOString().slice(0, 10);
export const addDays = (date: string, days: number): string => toDate(toTime(date) + days * DAY_MS);

export interface Bucket {
  period: string;
  start: string;
  end: string;
}

function isoWeek(date: string): Bucket {
  const time = toTime(date);
  const weekday = (new Date(time).getUTCDay() + 6) % 7; // Monday 0
  const start = toDate(time - weekday * DAY_MS);
  const thursday = new Date(time + (3 - weekday) * DAY_MS);
  const year = thursday.getUTCFullYear();
  const week = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / (7 * DAY_MS)) + 1;
  return { period: `${year}-W${String(week).padStart(2, "0")}`, start, end: addDays(start, 6) };
}

export function bucketOf(date: string, bucket: CostBucket): Bucket {
  if (bucket === "day") return { period: date, start: date, end: date };
  if (bucket === "week") return isoWeek(date);
  const [year, month] = date.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { period: date.slice(0, 7), start: `${date.slice(0, 7)}-01`, end: `${date.slice(0, 7)}-${String(last).padStart(2, "0")}` };
}

export function bucketsBetween(from: string, to: string, bucket: CostBucket): Bucket[] {
  const buckets: Bucket[] = [];
  for (let date = from; date <= to; ) {
    const current = bucketOf(date, bucket);
    buckets.push(current);
    date = addDays(current.end, 1);
  }
  return buckets;
}

// D2: native keeps each currency apart; usd states the total as one USD
// amount at 1 AI Credit = $0.01 (the caller states the conversion).
export function costInCurrency(total: CostTotal, currency: CostCurrencyChoice): CostTotal {
  if (currency === "native") return total;
  return { ...total, amounts: total.usd === null ? [] : [{ currency: "USD", amount: total.usd, knownTurns: total.knownTurns }] };
}

const CURRENCIES: readonly Currency[] = ["AI_CREDITS", "USD"];

export function addCostTotals(a: CostTotal, b: CostTotal): CostTotal {
  const amounts = CURRENCIES.flatMap((currency): CostAmount[] => {
    const parts = [...a.amounts, ...b.amounts].filter((amount) => amount.currency === currency);
    if (parts.length === 0) return [];
    return [{ currency, amount: parts.reduce((sum, part) => sum + part.amount, 0), knownTurns: parts.reduce((sum, part) => sum + part.knownTurns, 0) }];
  });
  return {
    turns: a.turns + b.turns,
    knownTurns: a.knownTurns + b.knownTurns,
    amounts,
    usd: a.usd === null && b.usd === null ? null : (a.usd ?? 0) + (b.usd ?? 0),
    estimated: a.estimated || b.estimated,
    apiEquivalentTurns: a.apiEquivalentTurns + b.apiEquivalentTurns,
  };
}

function minusOneYear(date: string): string {
  const year = Number(date.slice(0, 4)) - 1;
  const rest = date.slice(4) === "-02-29" ? "-02-28" : date.slice(4);
  return `${String(year).padStart(4, "0")}${rest}`;
}

// §8.2's "change versus the previous period": the same number of days just
// before, or the same dates a year earlier.
export function comparisonPeriod(since: string, until: string, period: ComparePeriod): { since: string; until: string } {
  if (period === "last-year") return { since: minusOneYear(since), until: minusOneYear(until) };
  const days = Math.round((toTime(until) - toTime(since)) / DAY_MS) + 1;
  return { since: addDays(since, -days), until: addDays(since, -1) };
}
