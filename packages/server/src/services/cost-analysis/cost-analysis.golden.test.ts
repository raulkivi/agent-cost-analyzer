// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { costComparisonSchema, costSeriesSchema, projectCostSchema } from "@agent-cost-analyzer/domain";
import { composeCostFixture } from "../../test-support/cost-analysis-fixture.js";

// Phase 15 step 15.7 exit criterion (plan §14): golden outputs for a fixture
// dataset across three providers and two projects, over the real pricing
// (the bundled price book), attribution and Insights dataset. Each output is
// committed as JSON under __golden__/ (update with `vitest -u` after
// checking the diff by hand); a few figures are checked by hand below.

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const golden = (name: string) => `./__golden__/${name}.json`;

describe("cost analyses over the fixture dataset (golden)", () => {
  const { api, costAnalysis } = composeCostFixture();

  it("time series by project, monthly", async () => {
    const series = costSeriesSchema.parse(await api.getCostTimeSeries({ groupBy: "project" }));
    await expect(json(series)).toMatchFileSnapshot(golden("timeseries-project-month"));

    // September holds only cc-0's turn, before the price book's first price: a gap, never 0.
    const portal = series.series.find((line) => line.key === "portal")!;
    expect(portal.points[0]).toMatchObject({ period: "2026-09", turns: 1, cost: { knownTurns: 0, usd: null, amounts: [] } });
    // October: cp-1 billed 1 + 0.9 AI Credits; cc-1 priced $0.0062 + $0.0023 (API-equivalent).
    const october = portal.points[1]!;
    expect(october.cost.amounts).toEqual([
      { currency: "AI_CREDITS", amount: 1.9, knownTurns: 2 },
      { currency: "USD", amount: expect.closeTo(0.0085, 10), knownTurns: 2 },
    ]);
    expect(october.cost.usd).toBeCloseTo(0.0275, 10);
    expect(october.cost.apiEquivalentTurns).toBe(2);
    expect(october.cumulative).toMatchObject({ turns: 5, knownTurns: 4 });
    // Billing: cp-2 billed 2.5 AI Credits; pi reported $0.05, then priced $0.003.
    const billing = series.series.find((line) => line.key === "billing")!;
    expect(billing.total.amounts).toEqual([
      { currency: "AI_CREDITS", amount: 2.5, knownTurns: 1 },
      { currency: "USD", amount: expect.closeTo(0.053, 10), knownTurns: 2 },
    ]);
    expect(series.totals.preferredBasisTurns).toEqual({ billed: 3, reported: 1, priced: 4, unknown: 2 });
    expect(series.series.map((line) => line.key)).toEqual(["billing", "portal", null]);
    // The documented changes for the models priced: Sonnet 5.5's cache-read cut on both
    // channels, and OpenAI's extended cache-write price for GPT-6.1 Sol.
    expect(series.priceChanges.map((marker) => [marker.date, marker.channel, marker.modelId])).toEqual([
      ["2026-10-07", "anthropic-api", "claude-sonnet-5.5"],
      ["2026-10-07", "github-copilot", "claude-sonnet-5.5"],
      ["2026-10-20", "openai-api", "gpt-6.1-sol"],
    ]);
    expect(series.priceChanges[1]!.changes).toEqual([{ tier: 0, tokenType: "cachedInput", fromUsdPerM: 0.2, toUsdPerM: 0.1, percent: -50 }]);
  });

  it("time series by repository, weekly, in USD", async () => {
    const series = costSeriesSchema.parse(await api.getCostTimeSeries({ groupBy: "repository", bucket: "week", since: "2026-10-01", until: "2026-10-31", currency: "usd" }));
    await expect(json(series)).toMatchFileSnapshot(golden("timeseries-repository-week-usd"));

    expect(series.series.map((line) => line.key)).toEqual(["github.com/acme/billing", "github.com/acme/portal-web", "github.com/acme/portal-api", "path:notes", "local:scratch"]);
    // cp-3's local repository: one turn, nothing known.
    expect(series.series.at(-1)).toMatchObject({ turns: 1, total: { knownTurns: 0, usd: null, amounts: [] } });
    // portal-web, ISO week 41 (2026-10-05..11): cp-1's two turns, 1.9 AI Credits = $0.019.
    const web = series.series.find((line) => line.key === "github.com/acme/portal-web")!;
    expect(web.points.find((point) => point.period === "2026-W41")!.cost.amounts).toEqual([{ currency: "USD", amount: expect.closeTo(0.019, 10), knownTurns: 2 }]);
    expect(series.conversion).toContain("1 AI Credit = $0.01");
    expect(JSON.stringify(series)).not.toContain("/home/dev");
  });

  it("time series by vendor, daily, billed only", async () => {
    const series = costSeriesSchema.parse(await api.getCostTimeSeries({ groupBy: "vendor", bucket: "day", basis: "billed", since: "2026-10-05", until: "2026-10-09" }));
    await expect(json(series)).toMatchFileSnapshot(golden("timeseries-vendor-day-billed"));

    expect(series.points.map((point) => [point.period, point.turns, point.cost.amounts[0]?.amount ?? null])).toEqual([
      ["2026-10-05", 1, null],
      ["2026-10-06", 1, 1],
      ["2026-10-07", 0, null],
      ["2026-10-08", 1, 0.9],
      ["2026-10-09", 1, null],
    ]);
    expect(series.points[0]!.coverage).toMatchObject({ billed: { turns: 1, knownTurns: 0 }, priced: { turns: 1, knownTurns: 1 } });
  });

  it("time series by model at today's prices", async () => {
    const series = costSeriesSchema.parse(await api.getCostTimeSeries({ groupBy: "model", basis: "priced", pricing: "today", since: "2026-10-01", until: "2026-10-31" }));
    await expect(json(series)).toMatchFileSnapshot(golden("timeseries-model-priced-today"));

    // At today's prices cp-1's first turn is priced after the cut too: 0.79 + 0.79 AI Credits.
    const sonnet = series.series.find((line) => line.key === "claude-sonnet-5.5")!;
    expect(sonnet.total.amounts[0]).toEqual({ currency: "AI_CREDITS", amount: expect.closeTo(1.58, 10), knownTurns: 2 });
    expect(series.pricing).toBe("today");
  });

  it("inside the portal project", async () => {
    const cost = projectCostSchema.parse(await costAnalysis.getProjectCost({ projectId: "portal", bucket: "month", basis: "preferred", pricing: "as-of-use", currency: "native", since: "2026-10-01", until: "2026-10-31" }));
    await expect(json(cost)).toMatchFileSnapshot(golden("project-portal"));

    expect(cost.byRepository.map((row) => [row.key, row.turns])).toEqual([
      ["github.com/acme/portal-web", 2],
      ["github.com/acme/portal-api", 2],
    ]);
    expect(cost.byVendor.map((vendor) => [vendor.key, vendor.models.map((model) => model.key)])).toEqual([["anthropic", ["claude-sonnet-5.5", "claude-sonnet-5-5-20261001"]]]);
    expect(cost.topSessions.map((session) => session.sessionId)).toEqual(["cp-1", "cc-1"]);
    expect(JSON.stringify(cost)).not.toContain("Acme Corp");
  });

  it("compares the two projects with the previous period", async () => {
    const comparison = costComparisonSchema.parse(await api.getCostComparison({ groupBy: "project", ids: "portal,billing", since: "2026-10-01", until: "2026-10-31" }));
    await expect(json(comparison)).toMatchFileSnapshot(golden("compare-projects-previous"));

    const [portal, billing] = comparison.rows;
    // Portal's previous period holds only cc-0's unknown turn: the change is unknown, not "from 0".
    expect(portal!.previous).toMatchObject({ turns: 1, total: { knownTurns: 0, usd: null } });
    expect(portal!.change.every((change) => change.previous === null && change.absolute === null)).toBe(true);
    expect(portal).toMatchObject({ sessions: 2, turns: 4, activeDays: 4 });
    expect(portal!.perSession).toEqual([
      { currency: "AI_CREDITS", amount: 0.95 },
      { currency: "USD", amount: expect.closeTo(0.00425, 10) },
    ]);
    expect(billing!.share).toEqual([
      { currency: "AI_CREDITS", share: expect.closeTo(2.5 / 4.4, 10) },
      { currency: "USD", share: expect.closeTo(0.053 / 0.0615, 10) },
    ]);
  });

  it("compares repositories with the same dates last year, in USD", async () => {
    const comparison = costComparisonSchema.parse(
      await api.getCostComparison({ groupBy: "repository", ids: "github.com/acme/portal-web,github.com/acme/billing,local:scratch", since: "2026-10-01", until: "2026-10-31", comparePeriod: "last-year", currency: "usd" }),
    );
    await expect(json(comparison)).toMatchFileSnapshot(golden("compare-repositories-last-year-usd"));
    expect(comparison).toMatchObject({ previousSince: "2025-10-01", previousUntil: "2025-10-31" });
    expect(comparison.rows[2]).toMatchObject({ key: "local:scratch", turns: 1, total: { usd: null }, share: [] });
  });
});
