import { describe, expect, it } from "vitest";
import { costComparisonSchema } from "@agent-cost-analyzer/domain";
import { billed, costs, cubeOf, cubeRow, priced, reported, unknownFigure } from "../../test-support/cost-cube-fakes.js";
import { buildCostComparison, type CostComparisonQuery } from "./comparison-builder.js";

// Phase 15 step 15.7 (plan §8.2, §10.1.1 CostComparison): the §8.2 measures
// per repository or project, a pure function over the cost cube.

const query: CostComparisonQuery = {
  groupBy: "project",
  ids: ["app", "portal"],
  since: "2026-10-01",
  until: "2026-10-31",
  comparePeriod: "previous",
  basis: "preferred",
  pricing: "as-of-use",
  currency: "native",
};

const cube = cubeOf([
  // app, this period: 3 turns in 2 sessions on 2 days, 6 USD known of 3 turns
  cubeRow({ date: "2026-10-02", projectId: "app", sessionKey: "p:a1", uncachedInput: 100, cacheWrite: 0, cacheRead: 300, output: 100, cost: costs({ priced: priced(2, "v") }) }),
  cubeRow({ date: "2026-10-02", projectId: "app", sessionKey: "p:a1", uncachedInput: 100, cacheWrite: 0, cacheRead: 300, output: 100, cost: costs({ priced: priced(4, "v") }) }),
  cubeRow({ date: "2026-10-09", projectId: "app", sessionKey: "p:a2", uncachedInput: 100, cacheWrite: 0, cacheRead: 300, output: 100, cost: costs({ priced: unknownFigure() }) }),
  // app, the previous period (2026-08-31 .. 2026-09-30): 4 USD
  cubeRow({ date: "2026-09-15", projectId: "app", sessionKey: "p:a0", cost: costs({ priced: priced(4, "v") }) }),
  // portal, this period: billed AI Credits and reported USD
  cubeRow({ date: "2026-10-05", projectId: "portal", sessionKey: "p:b1", uncachedInput: 50, cacheWrite: 50, cacheRead: 0, output: 900, cost: costs({ billed: billed(200) }) }),
  cubeRow({ date: "2026-10-06", projectId: "portal", sessionKey: "p:b2", uncachedInput: null, cacheWrite: 0, cacheRead: 0, output: 10, cost: costs({ reported: reported(2) }) }),
  // another project, not compared
  cubeRow({ date: "2026-10-05", projectId: "other", cost: costs({ priced: priced(100, "v") }) }),
]);

describe("buildCostComparison", () => {
  const comparison = costComparisonSchema.parse(buildCostComparison(cube, query));
  const [app, portal] = comparison.rows;

  it("states the period, the comparison period and the view", () => {
    expect(comparison).toMatchObject({
      since: "2026-10-01",
      until: "2026-10-31",
      previousSince: "2026-08-31",
      previousUntil: "2026-09-30",
      groupBy: "project",
      basis: "preferred",
      currency: "native",
    });
    expect(comparison.rows.map((row) => [row.key, row.label])).toEqual([
      ["app", "App"],
      ["portal", "Customer portal"],
    ]);
  });

  it("gives the total with coverage, sessions, turns and active days", () => {
    expect(app).toMatchObject({ sessions: 2, turns: 3, activeDays: 2 });
    expect(app!.total).toMatchObject({ turns: 3, knownTurns: 2, usd: 6, amounts: [{ currency: "USD", amount: 6, knownTurns: 2 }] });
    expect(app!.coverage.priced).toEqual({ turns: 3, knownTurns: 2 });
  });

  it("gives the change against the previous period per currency", () => {
    expect(app!.previous).toMatchObject({ sessions: 1, turns: 1, total: { usd: 4 } });
    expect(app!.change).toEqual([{ currency: "USD", current: 6, previous: 4, absolute: 2, ratio: 0.5 }]);
    // portal had nothing before: the change is unknown, never "from 0"
    expect(portal!.change).toEqual([
      { currency: "AI_CREDITS", current: 200, previous: null, absolute: null, ratio: null },
      { currency: "USD", current: 2, previous: null, absolute: null, ratio: null },
    ]);
  });

  it("normalises per session, per active day and per turn, per currency", () => {
    expect(app!.perSession).toEqual([{ currency: "USD", amount: 3 }]);
    expect(app!.perActiveDay).toEqual([{ currency: "USD", amount: 3 }]);
    expect(app!.perTurn).toEqual([{ currency: "USD", amount: 2 }]);
    expect(portal!.perSession).toEqual([
      { currency: "AI_CREDITS", amount: 100 },
      { currency: "USD", amount: 1 },
    ]);
  });

  it("gives each id's share of the compared total per currency", () => {
    expect(app!.share).toEqual([{ currency: "USD", share: 0.75 }]);
    expect(portal!.share).toEqual([
      { currency: "AI_CREDITS", share: 1 },
      { currency: "USD", share: 0.25 },
    ]);
    expect(comparison.total.amounts).toEqual([
      { currency: "AI_CREDITS", amount: 200, knownTurns: 1 },
      { currency: "USD", amount: 8, knownTurns: 3 },
    ]);
  });

  it("gives the cache-hit ratio and output share over the turns whose tokens are known", () => {
    expect(app!.cacheHitRatio).toBe(0.75);
    expect(app!.outputShare).toBe(0.2);
    expect(portal!.cacheHitRatio).toBe(0);
    expect(portal!.outputShare).toBe(0.9);
  });

  it("compares in USD at 1 AI Credit = $0.01 when asked", () => {
    const usd = buildCostComparison(cube, { ...query, currency: "usd" });
    expect(usd.rows[1]!.total.amounts).toEqual([{ currency: "USD", amount: 4, knownTurns: 2 }]);
    expect(usd.rows[1]!.share).toEqual([{ currency: "USD", share: 0.4 }]);
    expect(usd.conversion).toContain("1 AI Credit = $0.01");
  });

  it("compares with the same dates a year earlier when asked", () => {
    expect(buildCostComparison(cube, { ...query, comparePeriod: "last-year" })).toMatchObject({ previousSince: "2025-10-01", previousUntil: "2025-10-31" });
  });

  it("keeps an id with no turns as a row with nothing known, never zero", () => {
    const empty = buildCostComparison(cube, { ...query, ids: ["app", "missing"] }).rows[1]!;
    expect(empty).toMatchObject({ key: "missing", turns: 0, sessions: 0, activeDays: 0, total: { usd: null, amounts: [] }, perSession: [], share: [], cacheHitRatio: null, outputShare: null });
  });
});
