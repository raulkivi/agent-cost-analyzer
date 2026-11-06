import {
  bucketsBetween,
  type BasisCoverage,
  type CostBucket,
  type CostComparison,
  type CostComparisonRow,
  type CostPoint,
  type CostSeries,
  type CostSeriesLine,
  type CostTotal,
  type CostVariance,
  type Currency,
  type PriceChangeMarker,
  type ProjectCost,
} from "@agent-cost-analyzer/domain";

// Phase 15 step 15.9: sample GET /api/cost/* answers for the cost tabs'
// component tests and the extension's UI check (which imports this file).
// Sample data only, shaped like the approved mock-ups (Main.dc.html,
// Compare.dc.html): three projects over the last 90 days to 2026-11-06,
// weekly; Internal tools has a week with turns but no known cost (a gap)
// and a partly covered week; one documented price change on 2026-10-07.

export const COST_FIXTURE_NOW = new Date("2026-11-06T12:00:00.000Z");
export const COST_FIXTURE_RANGE = { since: "2026-08-09", until: "2026-11-06" } as const;

const TURNS_PER_POINT = 12;

export function costTotal(usd: number | null, options: { turns?: number; knownTurns?: number; currency?: Currency } = {}): CostTotal {
  const turns = options.turns ?? (usd === null ? 0 : TURNS_PER_POINT);
  const knownTurns = options.knownTurns ?? (usd === null ? 0 : turns);
  const currency = options.currency ?? "AI_CREDITS";
  return {
    turns,
    knownTurns,
    amounts: usd === null ? [] : [{ currency, amount: currency === "USD" ? usd : usd / 0.01, knownTurns }],
    usd,
    estimated: false,
    apiEquivalentTurns: 0,
  };
}

export function coverage(turns: number, knownTurns: number): BasisCoverage {
  const each = { turns, knownTurns };
  return { preferred: each, billed: { turns, knownTurns: 0 }, reported: { turns, knownTurns: 0 }, priced: each };
}

interface PointSpec {
  usd: number | null; // null with turns: unknown (a gap)
  turns: number;
  knownTurns: number;
}

function addTotals(a: CostTotal, b: CostTotal): CostTotal {
  return {
    turns: a.turns + b.turns,
    knownTurns: a.knownTurns + b.knownTurns,
    amounts: [...a.amounts, ...b.amounts].reduce<CostTotal["amounts"]>((sum, amount) => {
      const found = sum.find((entry) => entry.currency === amount.currency);
      if (found) {
        found.amount += amount.amount;
        found.knownTurns += amount.knownTurns;
        return sum;
      }
      return [...sum, { ...amount }];
    }, []),
    usd: a.usd === null && b.usd === null ? null : (a.usd ?? 0) + (b.usd ?? 0),
    estimated: false,
    apiEquivalentTurns: 0,
  };
}

function lineOf(key: string | null, label: string, specs: PointSpec[], bucket: CostBucket, range: { since: string; until: string }, currency: Currency): CostSeriesLine {
  const buckets = bucketsBetween(range.since, range.until, bucket);
  let cumulative = costTotal(null);
  const points: CostPoint[] = buckets.map((period, index) => {
    const spec = specs[index] ?? { usd: 0, turns: 0, knownTurns: 0 };
    const cost = costTotal(spec.turns === 0 ? null : spec.usd, { turns: spec.turns, knownTurns: spec.knownTurns, currency });
    cumulative = addTotals(cumulative, cost);
    return { ...period, sessions: spec.turns === 0 ? 0 : 3, turns: spec.turns, cost, cumulative, coverage: coverage(spec.turns, spec.knownTurns) };
  });
  const total = points.reduce((sum, point) => addTotals(sum, point.cost), costTotal(null));
  return {
    key,
    label,
    sessions: points.reduce((sum, point) => sum + point.sessions, 0),
    turns: total.turns,
    total,
    coverage: coverage(total.turns, total.knownTurns),
    points,
  };
}

const credits = (values: (number | null)[], gapTurns = TURNS_PER_POINT): PointSpec[] =>
  values.map((value) => (value === null ? { usd: null, turns: gapTurns, knownTurns: 0 } : { usd: value * 0.01, turns: TURNS_PER_POINT, knownTurns: TURNS_PER_POINT }));

export const PRICE_MARKER: PriceChangeMarker = {
  kind: "documented",
  date: "2026-10-07",
  channel: "github-copilot",
  modelId: "claude-sonnet-5.5",
  fromVersionId: "github-copilot:claude-sonnet-5.5:2026-10-01",
  toVersionId: "github-copilot:claude-sonnet-5.5:2026-10-07",
  changes: [{ tier: 0, tokenType: "cachedInput", fromUsdPerM: 0.2, toUsdPerM: 0.1, percent: -50 }],
  sourceIds: ["gh-pricing-table"],
};

export interface SeriesSpec {
  key: string | null;
  label: string;
  values: (number | null)[]; // AI Credits per week; null = turns with no known cost
  currency?: Currency;
  partialAt?: number; // index of a partly covered week
}

export const THREE_PROJECTS: SeriesSpec[] = [
  { key: "portal", label: "Customer portal", values: [38, 42, 45, 51, 47, 40, 36, 39, 44, 49, 53, 58, 61] },
  { key: "billing", label: "Billing service", values: [22, 25, 28, 30, 26, 24, 21, 23, 27, 31, 33, 36, 38] },
  { key: "tools", label: "Internal tools", values: [10, 12, 15, 14, 13, 11, 9, null, 12, 16, 18, 17, 20], currency: "USD", partialAt: 10 },
];

export const MORE_PROJECTS: SeriesSpec[] = [
  ...THREE_PROJECTS,
  { key: "data", label: "Data platform", values: [6, 7, 6.5, 8, 9, 8.5, 7, 7.5, 8, 9.5, 10, 11, 11.5] },
  { key: "mobile", label: "Mobile app", values: [3, 3.5, 5, 4.5, 4, 3.8, 4.2, 4.6, 5, 5.2, 6.1, 6.4, 7] },
];

export function sampleCostSeries(
  specs: SeriesSpec[] = THREE_PROJECTS,
  options: { bucket?: CostBucket; range?: { since: string; until: string }; groupBy?: CostSeries["groupBy"]; priceChanges?: PriceChangeMarker[] } = {},
): CostSeries {
  const bucket = options.bucket ?? "week";
  const range = options.range ?? COST_FIXTURE_RANGE;
  const series = specs.map((spec) => {
    const points = credits(spec.values);
    if (spec.partialAt !== undefined && points[spec.partialAt]) points[spec.partialAt] = { ...points[spec.partialAt]!, knownTurns: 10 };
    return lineOf(spec.key, spec.label, points, bucket, range, spec.currency ?? "AI_CREDITS");
  });
  const total = series.reduce((sum, line) => addTotals(sum, line.total), costTotal(null));
  const points = series[0]?.points.map((point, index) => {
    const cost = series.reduce((sum, line) => addTotals(sum, line.points[index]!.cost), costTotal(null));
    return { ...point, cost, turns: cost.turns, coverage: coverage(cost.turns, cost.knownTurns) };
  }) ?? [];
  return {
    generatedAt: COST_FIXTURE_NOW.toISOString(),
    since: range.since,
    until: range.until,
    basis: "preferred",
    pricing: "as-of-use",
    currency: "native",
    conversion: "1 AI Credit = $0.01 (GitHub's documented rate); no other exchange rate is used.",
    bucket,
    groupBy: options.groupBy ?? "project",
    providers: [{ id: "vscode", label: "VS Code", available: true, sessionCount: 40, truncated: false }],
    sessions: series.reduce((sum, line) => sum + line.sessions, 0),
    turns: total.turns,
    undatedTurns: 0,
    total,
    totals: {
      preferred: total,
      billed: total,
      reported: costTotal(null),
      priced: total,
      preferredBasisTurns: { billed: total.knownTurns, reported: 0, priced: 0, unknown: total.turns - total.knownTurns },
      priceVersionIds: [PRICE_MARKER.fromVersionId, PRICE_MARKER.toVersionId],
      conversion: "1 AI Credit = $0.01 (GitHub's documented rate); no other exchange rate is used.",
    },
    points,
    series,
    byVendor: [],
    priceChanges: options.priceChanges ?? [PRICE_MARKER],
    observedChanges: [],
  };
}

const perCurrency = (usd: number) => [{ currency: "USD" as const, amount: usd }];

function compareRow(key: string, label: string, usd: number, previousUsd: number | null, sessions: number, activeDays: number, knownShare = 1): CostComparisonRow {
  const turns = sessions * 10;
  const knownTurns = Math.round(turns * knownShare);
  return {
    key,
    label,
    sessions,
    turns,
    activeDays,
    total: costTotal(usd, { turns, knownTurns, currency: "USD" }),
    coverage: coverage(turns, knownTurns),
    previous: { sessions, turns, total: costTotal(previousUsd, { turns, knownTurns: previousUsd === null ? 0 : turns, currency: "USD" }), coverage: coverage(turns, turns) },
    change: [
      {
        currency: "USD",
        current: usd,
        previous: previousUsd,
        absolute: previousUsd === null ? null : usd - previousUsd,
        ratio: previousUsd === null || previousUsd === 0 ? null : (usd - previousUsd) / previousUsd,
      },
    ],
    perSession: perCurrency(usd / sessions),
    perActiveDay: perCurrency(usd / activeDays),
    perTurn: perCurrency(usd / turns),
    share: [{ currency: "USD", share: 0 }],
    cacheHitRatio: 0.71,
    outputShare: 0.091,
  };
}

export function sampleCostComparison(): CostComparison {
  const rows = [
    compareRow("portal", "Customer portal", 6.03, 5.12, 214, 58, 0.98),
    compareRow("billing", "Billing service", 3.64, 3.01, 133, 49, 0.99),
    compareRow("tools", "Internal tools", 1.77, null, 96, 37, 0.84),
  ];
  const sum = rows.reduce((total, row) => total + row.total.usd!, 0);
  for (const row of rows) row.share = [{ currency: "USD", share: row.total.usd! / sum }];
  return {
    generatedAt: COST_FIXTURE_NOW.toISOString(),
    since: COST_FIXTURE_RANGE.since,
    until: COST_FIXTURE_RANGE.until,
    comparePeriod: "previous",
    previousSince: "2026-05-11",
    previousUntil: "2026-08-08",
    groupBy: "project",
    basis: "preferred",
    pricing: "as-of-use",
    currency: "usd",
    conversion: "1 AI Credit = $0.01 (GitHub's documented rate); no other exchange rate is used.",
    providers: [{ id: "vscode", label: "VS Code", available: true, sessionCount: 40, truncated: false }],
    undatedTurns: 0,
    total: rows.reduce((total, row) => addTotals(total, row.total), costTotal(null)),
    rows,
  };
}

// Step 15.10 (plan §11.4; board 3): the Project tab's two answers.
const breakdown = (key: string, label: string, usd: number) => ({ key, label, sessions: 3, turns: 10, cost: costTotal(usd, { turns: 10, knownTurns: 10 }), coverage: coverage(10, 10) });
const tokenTotal = (value: number) => ({ value, turns: 10, knownTurns: 10, estimated: false });

export function sampleProjectCost(): ProjectCost {
  const series = sampleCostSeries([{ key: "portal", label: "Customer portal", values: [100, 200] }], { groupBy: "project" });
  return {
    ...series,
    project: { id: "portal", name: "Customer portal" },
    byVendor: [
      { ...breakdown("anthropic", "Anthropic", 391.8), models: [breakdown("claude-sonnet-5.5", "claude-sonnet-5.5", 284.1), breakdown("claude-opus-5.5", "claude-opus-5.5", 107.7)] },
      { ...breakdown("openai", "OpenAI", 179.2), models: [breakdown("gpt-5.5", "gpt-5.5", 179.2)] },
    ],
    byRepository: [breakdown("github.com/acme/portal-web", "github.com/acme/portal-web", 571)],
    byTokenType: [
      { model: "claude-sonnet-5.5", vendorId: "anthropic", turns: 10, uncachedInput: tokenTotal(6_200_000), cacheWrite: tokenTotal(2_000_000), cacheRead: tokenTotal(31_400_000), reasoning: tokenTotal(500_000), output: tokenTotal(1_100_000) },
      { model: "gpt-5.5", vendorId: "openai", turns: 10, uncachedInput: tokenTotal(1_000_000), cacheWrite: tokenTotal(0), cacheRead: tokenTotal(3_000_000), reasoning: tokenTotal(0), output: tokenTotal(400_000) },
    ],
    topSessions: [],
  };
}

export function sampleCostVariance(): CostVariance {
  return {
    generatedAt: COST_FIXTURE_NOW.toISOString(),
    groupBy: "project",
    id: "portal",
    label: "Customer portal",
    periodA: { label: "2026-08", since: "2026-08-01", until: "2026-08-31" },
    periodB: { label: "2026-11", since: "2026-11-01", until: "2026-11-30" },
    basis: "priced",
    pricing: "as-of-use",
    currency: "usd",
    conversion: "Every amount is in USD: AI Credits converted at 1 AI Credit = $0.01",
    providers: [],
    currencies: [
      {
        currency: "USD",
        costA: 182.4,
        costB: 211.2,
        change: 28.8,
        usage: 41.3,
        price: -18.6,
        mix: 6.1,
        turnsA: 10,
        turnsB: 12,
        byTokenType: [],
        models: [],
      },
    ],
    notExplained: { periodA: { turns: 0 }, periodB: { turns: 2, reasons: ["Cannot price: unknown model"] } },
    priceChanges: [PRICE_MARKER],
  };
}
