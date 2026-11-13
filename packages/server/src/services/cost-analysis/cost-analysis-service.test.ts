// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { PriceBookEntry, PricingMode } from "@agent-cost-analyzer/domain";
import type { SessionRangeFilter } from "../tool-audit/audit-query-service.js";
import { billed, costLine, costs, cubeOf, cubeRow, priced } from "../../test-support/cost-cube-fakes.js";
import type { CostCube } from "./cost-cube.js";
import { CostAnalysisService, DatasetCostCubeSource } from "./cost-analysis-service.js";

// Phase 15 step 15.7 (plan §9, §10.1.4): the query service the HTTP API and
// the MCP tools share. It builds the cube once per request, in the pricing
// mode asked for, and hands it to the pure builders.

const version: PriceBookEntry = {
  id: "a:sonnet:2026-10-07",
  channel: "anthropic-api",
  modelId: "claude-sonnet-5.5",
  currency: "USD",
  effectiveFrom: "2026-10-07",
  tiers: [{ inputUsdPerM: 2, cachedInputUsdPerM: 0.1, cacheWriteUsdPerM: 2.5, outputUsdPerM: 10 }],
  kind: "list",
  sourceIds: ["s"],
  origin: "bundled",
};
const earlier: PriceBookEntry = { ...version, id: "a:sonnet:2026-10-01", effectiveFrom: "2026-10-01", effectiveTo: "2026-10-07", tiers: [{ ...version.tiers[0]!, cachedInputUsdPerM: 0.2 }] };

function setup(cube: CostCube = cubeOf([cubeRow({ date: "2026-10-08", projectId: "portal", cost: costs({ priced: priced(2, version.id) }) })])) {
  const requests: { range: SessionRangeFilter; pricing: PricingMode }[] = [];
  const service = new CostAnalysisService({
    cubes: { getCube: async (range, pricing) => (requests.push({ range, pricing }), cube) },
    priceVersions: { list: () => ({ channels: [], versions: [earlier, version], sources: [], gaps: [], unknown: [], problems: [] }) },
    projects: { projectName: (id) => (id === "portal" ? "Customer portal" : undefined) },
  });
  return { service, requests };
}

const view = { basis: "preferred", pricing: "as-of-use", currency: "native" } as const;

describe("CostAnalysisService", () => {
  it("reads the cube for the series' range and pricing mode, and marks price changes from the price book", async () => {
    const { service, requests } = setup();
    const series = await service.getTimeSeries({ ...view, pricing: "today", bucket: "month", since: "2026-10-01", until: "2026-10-31", providerId: "vscode", limit: 20 });
    expect(requests).toEqual([{ range: { providerId: "vscode", limit: 20, since: "2026-10-01", until: "2026-10-31" }, pricing: "today" }]);
    expect(series.priceChanges.map((marker) => marker.toVersionId)).toEqual([version.id]);
  });

  it("answers a repository's cost as the series grouped by that repository", async () => {
    const { service } = setup();
    const repository = await service.getRepositoryCost({ ...view, bucket: "month", repository: "github.com/acme/app" });
    const series = await service.getTimeSeries({ ...view, bucket: "month", groupBy: "repository", ids: ["github.com/acme/app"] });
    expect(repository).toEqual(series);
  });

  it("names the project from the projects file, and gives null for a project it doesn't know", async () => {
    const { service } = setup();
    expect((await service.getProjectCost({ ...view, bucket: "month", projectId: "portal" }))?.project).toEqual({ id: "portal", name: "Customer portal" });
    expect(await service.getProjectCost({ ...view, bucket: "month", projectId: "nope" })).toBeNull();
  });

  it("reads one cube from the start of the comparison period to the end of the period", async () => {
    const { service, requests } = setup();
    const comparison = await service.compare({ ...view, groupBy: "project", ids: ["portal", "app"], since: "2026-10-01", until: "2026-10-31", comparePeriod: "previous" });
    expect(requests[0]!.range).toEqual({ since: "2026-08-31", until: "2026-10-31" });
    expect(comparison.rows.map((row) => row.label)).toEqual(["Customer portal", "App"]);
  });

  it("works without a price book (no markers) and without a projects file (unknown projects)", async () => {
    const service = new CostAnalysisService({ cubes: { getCube: async () => cubeOf([cubeRow({ date: "2026-10-08", cost: costs({ priced: priced(2, version.id) }) })]) } });
    expect((await service.getTimeSeries({ ...view, bucket: "day" })).priceChanges).toEqual([]);
    expect(await service.getProjectCost({ ...view, bucket: "day", projectId: "portal" })).toBeNull();
  });
});

describe("DatasetCostCubeSource", () => {
  it("builds the cube from the Insights dataset priced in the asked mode", async () => {
    const calls: unknown[] = [];
    const source = new DatasetCostCubeSource({
      getDataset: async (filter, options) => {
        calls.push([filter, options]);
        return { generatedAt: "t", providers: [], sessions: [], turns: [], toolCalls: [], findings: [] };
      },
    });
    const cube = await source.getCube({ since: "2026-10-01" }, "today");
    expect(calls).toEqual([[{ since: "2026-10-01" }, { pricing: "today" }]]);
    expect(cube).toMatchObject({ generatedAt: "t", rows: [], undatedTurns: 0 });
  });

  // Step 15.10 (plan §8.4, §10.1.1): explain_cost_change and get_price_changes.
  it("explains a change from one cube, as of use, covering both periods, and names the price changes between them", async () => {
    const { service, requests } = setup();
    const variance = await service.explainChange({
      groupBy: "project",
      id: "portal",
      periodA: { label: "2026-08", since: "2026-08-01", until: "2026-08-31" },
      periodB: { label: "2026-10", since: "2026-10-01", until: "2026-10-31" },
      currency: "native",
      providerId: "vscode",
    });
    expect(requests).toEqual([{ range: { providerId: "vscode", since: "2026-08-01", until: "2026-10-31" }, pricing: "as-of-use" }]);
    expect(variance).toMatchObject({ id: "portal", label: "Customer portal", basis: "priced" });
  });

  it("lists documented changes from the price book and observed ones from the turns, as of use", async () => {
    const copilot = (date: string) =>
      Array.from({ length: 20 }, () => cubeRow({ date, channel: "github-copilot", model: "claude-sonnet-5.5", cost: costs({ billed: billed(12), priced: priced(10, "gh", "AI_CREDITS") }) }));
    const { service, requests } = setup(cubeOf([...copilot("2026-10-13"), ...copilot("2026-10-20")]));
    const list = await service.getPriceChanges({ since: "2026-10-01", until: "2026-10-31" });
    expect(requests).toEqual([{ range: { since: "2026-10-01", until: "2026-10-31" }, pricing: "as-of-use" }]);
    expect(list.changes.map((change) => [change.kind, change.date])).toEqual([
      ["documented", "2026-10-07"],
      ["observed", "2026-10-12"],
    ]);
    expect(list.providers).toHaveLength(1);
  });

  // Step 10.19 (classic subagents plan §4.5): billed and priced are compared
  // per cost line's model, so a run's gap is never the turn's model's.
  it("finds observed changes per cost line's model", async () => {
    const turns = (date: string) =>
      Array.from({ length: 20 }, () =>
        cubeRow({
          date,
          channel: "github-copilot",
          model: "claude-sonnet-5.5",
          cost: costs({ billed: billed(22), priced: priced(20, "gh", "AI_CREDITS") }),
          lines: [
            costLine("claude-sonnet-5.5", "anthropic", costs({ billed: billed(10), priced: priced(10, "gh", "AI_CREDITS") }), { subagent: false }),
            costLine("gpt-6.1-sol", "openai", costs({ billed: billed(12), priced: priced(10, "gh:sol", "AI_CREDITS") })),
          ],
        }),
      );
    const { service } = setup(cubeOf([...turns("2026-10-13"), ...turns("2026-10-20")]));
    const list = await service.getPriceChanges({ since: "2026-10-01", until: "2026-10-31", kind: "observed" });
    expect(list.changes.map((change) => [change.kind, change.modelId])).toEqual([["observed", "gpt-6.1-sol"]]);
  });

  it("reads no sessions for documented changes alone", async () => {
    const { service, requests } = setup();
    const list = await service.getPriceChanges({ kind: "documented" });
    expect(requests).toEqual([]);
    expect(list.changes.map((change) => change.kind)).toEqual(["documented"]);
    expect(list.providers).toEqual([]);
  });
});
