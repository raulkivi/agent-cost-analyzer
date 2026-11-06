import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { costVarianceSchema, type CostFigure, type PriceBookEntry } from "@agent-cost-analyzer/domain";
import { billed, costs, cubeOf, cubeRow, unknownFigure } from "../../test-support/cost-cube-fakes.js";
import type { CostCubeRow } from "./cost-cube.js";
import { buildCostVariance, type CostVarianceQuery } from "./variance-analyzer.js";

// Phase 15 step 15.10 (plan §8.4, D12): why a project's (or repository's)
// priced cost changed between two periods, as usage (volume), price and mix
// effects that add up exactly to the change. A pure function over the cube.

const AUGUST = { label: "2026-08", since: "2026-08-01", until: "2026-08-31" };
const OCTOBER = { label: "2026-10", since: "2026-10-01", until: "2026-10-31" };
const query: CostVarianceQuery = { groupBy: "project", id: "app", periodA: AUGUST, periodB: OCTOBER, currency: "native" };

// A turn of `output` tokens only, priced at `perM` per 1M tokens.
function outputTurn(date: string, model: string, tokens: number, perM: number, overrides: Partial<CostCubeRow> = {}): CostCubeRow {
  const amount = (tokens * perM) / 1_000_000;
  const figure: CostFigure = {
    known: true,
    amount,
    currency: "USD",
    basis: "priced",
    priceVersionIds: [`${model}:${perM}`],
    byTokenType: { uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: amount },
  };
  return cubeRow({ date, projectId: "app", model, uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: tokens, cost: costs({ priced: figure }), ...overrides });
}

const sumOf = (row: { usage: number; price: number; mix: number }) => row.usage + row.price + row.mix;

describe("buildCostVariance", () => {
  it("splits a pure price change into a price effect", () => {
    const cube = cubeOf([outputTurn("2026-08-10", "sonnet", 1_000_000, 10), outputTurn("2026-10-10", "sonnet", 1_000_000, 8)]);
    const variance = costVarianceSchema.parse(buildCostVariance(cube, query, []));
    expect(variance.currencies).toHaveLength(1);
    expect(variance.currencies[0]).toMatchObject({ currency: "USD", costA: 10, costB: 8, change: -2, usage: 0, mix: 0, price: -2, turnsA: 1, turnsB: 1 });
    expect(variance.currencies[0]!.models[0]!.byTokenType).toEqual([
      { tokenType: "output", tokensA: 1_000_000, tokensB: 1_000_000, unitPriceA: 10, unitPriceB: 8, costA: 10, costB: 8, usage: 0, price: -2 },
    ]);
  });

  it("splits more work at the same price into a usage effect", () => {
    const cube = cubeOf([outputTurn("2026-08-10", "sonnet", 1_000_000, 10), outputTurn("2026-10-10", "sonnet", 3_000_000, 10)]);
    expect(buildCostVariance(cube, query, []).currencies[0]).toMatchObject({ change: 20, usage: 20, price: 0, mix: 0 });
  });

  it("shows moving the same work to a cheaper model as a mix effect (D12)", () => {
    const cube = cubeOf([outputTurn("2026-08-10", "opus", 1_000_000, 30), outputTurn("2026-10-10", "sonnet", 1_000_000, 10)]);
    const [usd] = costVarianceSchema.parse(buildCostVariance(cube, query, [])).currencies;
    expect(usd).toMatchObject({ change: -20, usage: 0, price: 0, mix: -20 });
    // A new model is all usage at its own price; a dropped one, minus its cost.
    expect(usd!.models.map((model) => [model.model, model.usage, model.price])).toEqual([
      ["opus", -30, 0],
      ["sonnet", 10, 0],
    ]);
    expect(usd!.byTokenType).toEqual([{ tokenType: "output", tokensA: 1_000_000, tokensB: 1_000_000, averagePriceA: 30, usage: 0, mix: -20, price: 0 }]);
  });

  it("adds all three up exactly to the change in a mixed case, and gives the price versions behind each model", () => {
    const cube = cubeOf([
      outputTurn("2026-08-03", "sonnet", 2_000_000, 15),
      outputTurn("2026-08-04", "opus", 1_000_000, 75),
      outputTurn("2026-10-05", "sonnet", 5_000_000, 12),
      outputTurn("2026-10-06", "opus", 500_000, 75),
    ]);
    const [usd] = costVarianceSchema.parse(buildCostVariance(cube, query, [])).currencies;
    expect(usd!.costA).toBeCloseTo(105, 9);
    expect(usd!.costB).toBeCloseTo(97.5, 9);
    expect(sumOf(usd!)).toBeCloseTo(usd!.change, 9);
    const sonnet = usd!.models.find((model) => model.model === "sonnet")!;
    expect(sonnet).toMatchObject({ priceVersionIdsA: ["sonnet:15"], priceVersionIdsB: ["sonnet:12"] });
    expect(sonnet.usage).toBeCloseTo(45, 9); // (5M − 2M) × $15
    expect(sonnet.price).toBeCloseTo(-15, 9); // 5M × ($12 − $15)
  });

  it("keeps currencies apart in native, AI Credits first, and converts everything to USD when asked", () => {
    const copilot = (date: string, credits: number): CostCubeRow =>
      cubeRow({
        date,
        projectId: "app",
        model: "sonnet",
        output: 1_000_000,
        uncachedInput: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cost: costs({ priced: { known: true, amount: credits, currency: "AI_CREDITS", basis: "priced", priceVersionIds: ["gh"], byTokenType: { uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: credits } } }),
      });
    const cube = cubeOf([copilot("2026-08-10", 1000), copilot("2026-10-10", 1500), outputTurn("2026-08-10", "sonnet", 1_000_000, 10), outputTurn("2026-10-10", "sonnet", 1_000_000, 10)]);
    expect(buildCostVariance(cube, query, []).currencies.map((row) => [row.currency, row.change])).toEqual([
      ["AI_CREDITS", 500],
      ["USD", 0],
    ]);
    const usd = costVarianceSchema.parse(buildCostVariance(cube, { ...query, currency: "usd" }, []));
    expect(usd.currencies.map((row) => [row.currency, row.costA, row.costB])).toEqual([["USD", 20, 25]]);
    expect(usd.conversion).toMatch(/1 AI Credit = \$0\.01/);
  });

  it("counts turns without a priced figure as not explained, with their reasons, never as 0 (constraint 6)", () => {
    const cube = cubeOf([
      outputTurn("2026-08-10", "sonnet", 1_000_000, 10),
      cubeRow({ date: "2026-10-10", projectId: "app", cost: costs({ billed: billed(100), priced: unknownFigure("Cannot price: unknown model") }) }),
      cubeRow({ date: "2026-10-11", projectId: "app", cost: costs({ priced: unknownFigure("Cannot price: unknown model") }) }),
    ]);
    const variance = costVarianceSchema.parse(buildCostVariance(cube, query, []));
    expect(variance.notExplained).toEqual({ periodA: { turns: 0 }, periodB: { turns: 2, reasons: ["Cannot price: unknown model"] } });
    expect(variance.currencies[0]).toMatchObject({ costA: 10, costB: 0, change: -10, turnsB: 0 });
  });

  it("selects by the asked id and period only, and states the view", () => {
    const cube = cubeOf([
      outputTurn("2026-08-10", "sonnet", 1_000_000, 10),
      outputTurn("2026-09-10", "sonnet", 9_000_000, 10),
      outputTurn("2026-10-10", "sonnet", 1_000_000, 10, { projectId: "portal" }),
    ]);
    const variance = costVarianceSchema.parse(buildCostVariance(cube, query, []));
    expect(variance).toMatchObject({ groupBy: "project", id: "app", label: "App", basis: "priced", pricing: "as-of-use", periodA: AUGUST, periodB: OCTOBER });
    expect(variance.currencies[0]).toMatchObject({ costA: 10, costB: 0 });
  });

  it("names the documented price changes between the two periods for the models compared", () => {
    const version = (id: string, from: string, to: string | undefined, perM: number): PriceBookEntry => ({
      id,
      channel: "anthropic-api",
      modelId: "claude-sonnet-5.5",
      currency: "USD",
      effectiveFrom: from,
      ...(to ? { effectiveTo: to } : {}),
      tiers: [{ inputUsdPerM: 3, cachedInputUsdPerM: 0.3, cacheWriteUsdPerM: 3.75, outputUsdPerM: perM }],
      kind: "list",
      sourceIds: ["s"],
      origin: "bundled",
    });
    const versions = [version("sonnet:10", "2026-08-01", "2026-09-15", 10), version("sonnet:8", "2026-09-15", undefined, 8)];
    const cube = cubeOf([outputTurn("2026-08-10", "sonnet", 1_000_000, 10, { cost: costs({ priced: { known: true, amount: 10, currency: "USD", basis: "priced", priceVersionIds: ["sonnet:10"], byTokenType: { uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 10 } } }) })]);
    expect(buildCostVariance(cube, query, versions).priceChanges.map((marker) => marker.date)).toEqual(["2026-09-15"]);
  });

  // The §15.10 exit criterion: effects add up exactly (property test).
  it("always adds usage, price and mix up to the change, per currency, per model and per token type", () => {
    const tokenTypes = ["uncachedInput", "cacheRead", "cacheWrite", "output"] as const;
    const turnArb = fc.record({
      inB: fc.boolean(),
      model: fc.constantFrom("a", "b", "c"),
      tokens: fc.record({ uncachedInput: fc.nat(5_000_000), cacheRead: fc.nat(5_000_000), cacheWrite: fc.nat(5_000_000), output: fc.nat(5_000_000) }),
      perM: fc.record({ uncachedInput: fc.double({ min: 0, max: 100, noNaN: true }), cacheRead: fc.double({ min: 0, max: 10, noNaN: true }), cacheWrite: fc.double({ min: 0, max: 100, noNaN: true }), output: fc.double({ min: 0, max: 200, noNaN: true }) }),
      credits: fc.boolean(),
    });
    fc.assert(
      fc.property(fc.array(turnArb, { maxLength: 30 }), fc.constantFrom("native" as const, "usd" as const), (turns, currency) => {
        const rows = turns.map((turn) => {
          const parts = Object.fromEntries(tokenTypes.map((type) => [type, (turn.tokens[type] * turn.perM[type]) / 1_000_000])) as Record<(typeof tokenTypes)[number], number>;
          const amount = tokenTypes.reduce((sum, type) => sum + parts[type], 0);
          return cubeRow({
            date: turn.inB ? "2026-10-10" : "2026-08-10",
            projectId: "app",
            model: turn.model,
            ...turn.tokens,
            cost: costs({ priced: { known: true, amount, currency: turn.credits ? "AI_CREDITS" : "USD", basis: "priced", priceVersionIds: ["v"], byTokenType: parts } }),
          });
        });
        const variance = costVarianceSchema.parse(buildCostVariance(cubeOf(rows), { ...query, currency }, []));
        for (const row of variance.currencies) {
          const scale = Math.max(1, row.costA, row.costB);
          expect(Math.abs(sumOf(row) - row.change)).toBeLessThanOrEqual(1e-6 * scale);
          for (const type of row.byTokenType) expect(Number.isFinite(type.usage + type.mix + type.price)).toBe(true);
          const typeSum = row.byTokenType.reduce((sum, type) => sum + type.usage + type.mix + type.price, 0);
          expect(Math.abs(typeSum - row.change)).toBeLessThanOrEqual(1e-6 * scale);
          const modelSum = row.models.reduce((sum, model) => sum + model.change, 0);
          expect(Math.abs(modelSum - row.change)).toBeLessThanOrEqual(1e-6 * scale);
        }
      }),
      { numRuns: 300 },
    );
  });
});
