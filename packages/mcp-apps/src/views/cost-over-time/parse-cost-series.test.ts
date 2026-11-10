// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { costSeries, projectCost } from "../../view-models/cost-analysis-fixtures.js";
import { parseCostSeries } from "./parse-cost-series.js";

describe("parseCostSeries", () => {
  it("accepts a get_repository_cost and a get_project_cost result", () => {
    const repository = costSeries();
    const project = projectCost();
    expect(parseCostSeries(repository)).toBe(repository);
    expect(parseCostSeries(project)).toBe(project);
  });

  it.each([
    undefined,
    null,
    "text",
    3,
    {},
    { ...costSeries(), points: undefined },
    { ...costSeries(), total: null },
    { ...costSeries(), totals: undefined },
    { ...costSeries(), byVendor: "x" },
    { ...costSeries(), priceChanges: undefined },
    { ...costSeries(), observedChanges: undefined },
    { ...costSeries(), bucket: 3 },
    { ...projectCost(), project: null },
    { ...projectCost(), topSessions: undefined },
    { ...projectCost(), byTokenType: undefined },
  ])("rejects %j", (value) => {
    expect(parseCostSeries(value)).toBeUndefined();
  });
});
