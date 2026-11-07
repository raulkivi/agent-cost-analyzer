// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { costSeriesSchema, type PriceBookEntry } from "@agent-cost-analyzer/domain";
import { billed, costs, cubeOf, cubeRow, priced, reported, unknownFigure } from "../../test-support/cost-cube-fakes.js";
import { buildCostSeries, type CostSeriesQuery } from "./time-series-builder.js";

// Phase 15 step 15.7 (plan §8.1, §10.1.1 CostSeries): cost over time, a pure
// function over the cost cube. Buckets are UTC; unknown is a gap, never 0.

const view: CostSeriesQuery = { bucket: "month", basis: "preferred", pricing: "as-of-use", currency: "native" };

function entry(id: string, effectiveFrom: string, effectiveTo: string | undefined, cachedInputUsdPerM: number, channel = "anthropic-api"): PriceBookEntry {
  return {
    id,
    channel,
    modelId: "claude-sonnet-5.5",
    currency: "USD",
    effectiveFrom,
    ...(effectiveTo ? { effectiveTo } : {}),
    tiers: [{ inputUsdPerM: 2, cachedInputUsdPerM, cacheWriteUsdPerM: 2.5, outputUsdPerM: 10 }],
    kind: "list",
    sourceIds: ["src"],
    origin: "bundled",
  };
}

const book = [
  entry("a:sonnet:2026-10-01", "2026-10-01", "2026-10-07", 0.2),
  entry("a:sonnet:2026-10-07", "2026-10-07", undefined, 0.1),
  entry("g:sonnet:2026-10-01", "2026-10-01", "2026-10-07", 0.2, "github-copilot"),
  entry("g:sonnet:2026-10-07", "2026-10-07", undefined, 0.1, "github-copilot"),
];

describe("buildCostSeries", () => {
  it("gives one point per bucket in the range, an empty bucket with no turns, and a running total", () => {
    const cube = cubeOf([
      cubeRow({ date: "2026-08-20", sessionKey: "p:a", cost: costs({ priced: priced(1, "v") }) }),
      cubeRow({ date: "2026-10-03", sessionKey: "p:b", cost: costs({ priced: priced(2, "v") }) }),
      cubeRow({ date: "2026-10-30", sessionKey: "p:b", cost: costs({ priced: priced(3, "v") }) }),
    ]);
    const series = costSeriesSchema.parse(buildCostSeries(cube, view, []));
    expect(series.points.map((point) => [point.period, point.turns, point.sessions, point.cost.usd, point.cumulative.usd])).toEqual([
      ["2026-08", 1, 1, 1, 1],
      ["2026-09", 0, 0, null, 1],
      ["2026-10", 2, 1, 5, 6],
    ]);
    expect(series.total).toMatchObject({ turns: 3, knownTurns: 3, usd: 6 });
    expect(series).toMatchObject({ sessions: 2, turns: 3, undatedTurns: 0, bucket: "month", series: [] });
  });

  it("leaves a bucket whose cost is all unknown as a gap with its coverage, never 0", () => {
    const cube = cubeOf([
      cubeRow({ date: "2026-10-05", cost: costs({ priced: priced(2, "v") }) }),
      cubeRow({ date: "2026-10-06", cost: costs({ priced: unknownFigure() }) }),
    ]);
    const series = buildCostSeries(cube, { ...view, bucket: "day" }, []);
    expect(series.points[1]).toMatchObject({ period: "2026-10-06", turns: 1, cost: { turns: 1, knownTurns: 0, usd: null, amounts: [] } });
    expect(series.points[1]!.coverage.priced).toEqual({ turns: 1, knownTurns: 0 });
    expect(series.points[1]!.cumulative).toMatchObject({ usd: 2, knownTurns: 1, turns: 2 });
  });

  it("buckets by ISO week and keeps the range given by since and until, inclusive", () => {
    const cube = cubeOf([
      cubeRow({ date: "2026-09-30", cost: costs({ priced: priced(9, "v") }) }),
      cubeRow({ date: "2026-10-05", cost: costs({ priced: priced(1, "v") }) }),
      cubeRow({ date: "2026-10-18", cost: costs({ priced: priced(2, "v") }) }),
      cubeRow({ date: "2026-10-19", cost: costs({ priced: priced(4, "v") }) }),
    ]);
    const series = buildCostSeries(cube, { ...view, bucket: "week", since: "2026-10-01", until: "2026-10-18" }, []);
    expect(series.points.map((point) => [point.period, point.start, point.end, point.cost.usd])).toEqual([
      ["2026-W40", "2026-09-28", "2026-10-04", null],
      ["2026-W41", "2026-10-05", "2026-10-11", 1],
      ["2026-W42", "2026-10-12", "2026-10-18", 2],
    ]);
    expect(series).toMatchObject({ since: "2026-10-01", until: "2026-10-18", turns: 2 });
  });

  it("uses one basis for the view when asked, gives coverage per basis, and totals per currency", () => {
    const cube = cubeOf([
      cubeRow({ date: "2026-10-05", cost: costs({ billed: billed(50), priced: priced(40, "g", "AI_CREDITS") }) }),
      cubeRow({ date: "2026-10-06", cost: costs({ reported: reported(0.25), priced: priced(0.3, "o") }) }),
    ]);
    const preferred = buildCostSeries(cube, view, []);
    expect(preferred.total.amounts).toEqual([
      { currency: "AI_CREDITS", amount: 50, knownTurns: 1 },
      { currency: "USD", amount: 0.25, knownTurns: 1 },
    ]);
    expect(preferred.points[0]!.coverage).toEqual({
      preferred: { turns: 2, knownTurns: 2 },
      billed: { turns: 2, knownTurns: 1 },
      reported: { turns: 2, knownTurns: 1 },
      priced: { turns: 2, knownTurns: 2 },
    });
    expect(preferred.totals.preferredBasisTurns).toEqual({ billed: 1, reported: 1, priced: 0, unknown: 0 });
    const billedOnly = buildCostSeries(cube, { ...view, basis: "billed" }, []);
    expect(billedOnly.total).toMatchObject({ turns: 2, knownTurns: 1, usd: 0.5 });
  });

  it("states everything in USD at 1 AI Credit = $0.01 when asked, saying so", () => {
    const cube = cubeOf([
      cubeRow({ date: "2026-10-05", cost: costs({ billed: billed(50) }) }),
      cubeRow({ date: "2026-10-06", cost: costs({ reported: reported(0.25) }) }),
    ]);
    const series = buildCostSeries(cube, { ...view, currency: "usd" }, []);
    expect(series.total.amounts).toEqual([{ currency: "USD", amount: 0.75, knownTurns: 2 }]);
    expect(series.points[0]!.cost.amounts).toEqual([{ currency: "USD", amount: 0.75, knownTurns: 2 }]);
    expect(series.conversion).toContain("1 AI Credit = $0.01");
  });

  it("gives one line per id asked for, matching a local repository by its redacted key and never returning its path", () => {
    const cube = cubeOf([
      cubeRow({ date: "2026-10-05", repositoryKey: "github.com/acme/app", cost: costs({ priced: priced(1, "v") }) }),
      cubeRow({ date: "2026-10-05", repositoryKey: "local:/home/dev/scratch", projectId: null, cost: costs({ priced: priced(2, "v") }) }),
      cubeRow({ date: "2026-10-05", repositoryKey: "github.com/acme/other", cost: costs({ priced: priced(4, "v") }) }),
    ]);
    const series = buildCostSeries(cube, { ...view, groupBy: "repository", ids: ["local:scratch", "github.com/acme/app"] }, []);
    expect(series.series.map((line) => [line.key, line.label, line.total.usd])).toEqual([
      ["local:scratch", "local:scratch", 2],
      ["github.com/acme/app", "github.com/acme/app", 1],
    ]);
    expect(series.total.usd).toBe(3);
    expect(JSON.stringify(series)).not.toContain("/home/dev");
  });

  it("without ids, gives every group, the most expensive first and the unknown bucket last with its reason", () => {
    const cube = cubeOf([
      cubeRow({ date: "2026-10-05", projectId: "app", cost: costs({ priced: priced(1, "v") }) }),
      cubeRow({ date: "2026-10-05", projectId: "portal", cost: costs({ priced: priced(5, "v") }) }),
      cubeRow({ date: "2026-10-05", repositoryKey: null, unattributedReason: "no folder", projectId: null, cost: costs({ priced: priced(9, "v") }) }),
    ]);
    const projects = buildCostSeries(cube, { ...view, groupBy: "project" }, []);
    expect(projects.series.map((line) => [line.key, line.label])).toEqual([
      ["portal", "Customer portal"],
      ["app", "App"],
      [null, "No project"],
    ]);
    const repositories = buildCostSeries(cube, { ...view, groupBy: "repository" }, []);
    expect(repositories.series.at(-1)).toMatchObject({ key: null, label: "Unattributed", reason: "no folder" });
  });

  it("breaks the selection down by vendor, then model", () => {
    const cube = cubeOf([
      cubeRow({ date: "2026-10-05", vendorId: "anthropic", model: "claude-sonnet-5.5", cost: costs({ priced: priced(1, "v") }) }),
      cubeRow({ date: "2026-10-05", vendorId: "anthropic", model: "claude-opus-5.5", cost: costs({ priced: priced(3, "v") }) }),
      cubeRow({ date: "2026-10-05", vendorId: null, vendorUnknownReason: "unknown model", model: "x", cost: costs({ priced: unknownFigure() }) }),
    ]);
    const series = buildCostSeries(cube, view, []);
    expect(series.byVendor.map((vendor) => [vendor.key, vendor.label, vendor.cost.usd, vendor.models.map((model) => model.key)])).toEqual([
      ["anthropic", "Anthropic", 4, ["claude-opus-5.5", "claude-sonnet-5.5"]],
      [null, "Unknown vendor", null, ["x"]],
    ]);
    expect(series.byVendor[1]).toMatchObject({ reason: "unknown model" });
  });

  it("marks the documented price changes in the range for the models the selection priced", () => {
    const cube = cubeOf([
      cubeRow({ date: "2026-10-05", cost: costs({ priced: priced(1, "a:sonnet:2026-10-01") }) }),
      cubeRow({ date: "2026-10-09", cost: costs({ priced: priced(1, "a:sonnet:2026-10-07") }) }),
    ]);
    const series = buildCostSeries(cube, view, book);
    expect(series.priceChanges.map((marker) => [marker.date, marker.channel, marker.toVersionId])).toEqual([["2026-10-07", "anthropic-api", "a:sonnet:2026-10-07"]]);
    expect(buildCostSeries(cube, { ...view, since: "2026-10-08" }, book).priceChanges).toEqual([]);
  });

  it("reports the cube's undated turns", () => {
    expect(buildCostSeries(cubeOf([], 2), view, []).undatedTurns).toBe(2);
  });
});

// Step 15.10 (plan §6.4 point 2, D11): observed changes beside the
// documented markers. A billing gap is the model's, not the selection's,
// so every turn of the cube counts; only models the selection used show.
describe("buildCostSeries: observed price changes", () => {
  const copilotTurns = (date: string, project: string, ratio: number) =>
    Array.from({ length: 20 }, () =>
      cubeRow({ date, projectId: project, model: "claude-sonnet-5.5", channel: "github-copilot", cost: costs({ billed: billed(10 * ratio), priced: priced(10, "gh:v", "AI_CREDITS") }) }),
    );
  const cube = cubeOf([
    ...copilotTurns("2026-10-13", "portal", 1.2),
    ...copilotTurns("2026-10-20", "portal", 1.2),
    cubeRow({ date: "2026-10-14", projectId: "app", model: "claude-sonnet-5.5", channel: "github-copilot", cost: costs({ billed: billed(12), priced: priced(10, "gh:v", "AI_CREDITS") }) }),
    cubeRow({ date: "2026-10-14", projectId: "other", model: "gpt-5.5", channel: "github-copilot", cost: costs({ billed: billed(1) }) }),
  ]);
  const october = { ...view, since: "2026-10-01", until: "2026-10-31" };

  it("lists an observed change for a model the selection used, found over every turn of the cube", () => {
    const series = costSeriesSchema.parse(buildCostSeries(cube, { ...october, groupBy: "project", ids: ["app"] }, []));
    expect(series.observedChanges.map((change) => [change.modelId, change.date, change.direction])).toEqual([["claude-sonnet-5.5", "2026-10-12", "above"]]);
  });

  it("leaves out models the selection didn't use, changes outside the range, and today's prices", () => {
    expect(buildCostSeries(cube, { ...october, groupBy: "project", ids: ["other"] }, []).observedChanges).toEqual([]);
    expect(buildCostSeries(cube, { ...october, since: "2026-10-13" }, []).observedChanges).toEqual([]);
    expect(buildCostSeries(cube, { ...october, pricing: "today" }, []).observedChanges).toEqual([]);
  });
});
