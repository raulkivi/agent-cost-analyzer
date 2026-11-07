// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { costEstimateSchema } from "@agent-cost-analyzer/domain";
import { billed, costs, cubeOf, cubeRow, priced, unknownFigure } from "../../test-support/cost-cube-fakes.js";
import { buildCostEstimate, estimateRows, type EstimateQuery } from "./estimate-builder.js";

// Phase 15 step 15.12 (plan §8.6, D16–D18): an estimate from a project's
// history at today's prices, a pure function over a cube priced "today".

const NOW = new Date("2026-11-06T12:00:00.000Z");
const query: EstimateQuery = { target: { groupBy: "project", id: "app", name: "App" }, unit: "activeDays", planned: 20, weeks: 12, now: NOW };

// One active day costing `usd` (priced, USD), in the project.
const day = (date: string, usd: number, extra: Partial<Parameters<typeof cubeRow>[0]> = {}) => cubeRow({ date, projectId: "app", cost: costs({ priced: priced(usd, "v") }), ...extra });

describe("buildCostEstimate", () => {
  it("multiplies the median and 90th-percentile cost per active day by the planned days (D16)", () => {
    const cube = cubeOf([day("2026-10-01", 10), day("2026-10-02", 20), day("2026-10-03", 30), day("2026-10-04", 40), day("2026-10-05", 50)]);
    const estimate = costEstimateSchema.parse(buildCostEstimate(cube, query));
    expect(estimate).toMatchObject({
      label: "estimate",
      pricing: "today",
      window: { weeks: 12, since: "2026-08-15", until: "2026-11-06" },
      history: { units: 5, knownUnits: 5, turns: 5, totalUsd: 150 },
      unitCost: { p50: 30, p90: 46 },
      range: { p50: 600, p90: 920 },
      runRate: { perActiveDayUsd: 30, perWeekUsd: 12.5 },
    });
  });

  it("sums a day's turns, converts AI Credits at $0.01, and counts a day only when every turn is priced (D18)", () => {
    const cube = cubeOf([
      day("2026-10-01", 10),
      day("2026-10-01", 0, { cost: costs({ priced: priced(500, "gh", "AI_CREDITS") }) }), // $5
      day("2026-10-02", 20),
      day("2026-10-03", 30),
      day("2026-10-04", 40),
      day("2026-10-05", 50),
      day("2026-10-06", 60),
      day("2026-10-06", 0, { cost: costs({ billed: billed(1), priced: unknownFigure("no price") }) }),
    ]);
    const estimate = buildCostEstimate(cube, query);
    expect(estimate.history).toEqual({ units: 6, knownUnits: 5, turns: 8, totalUsd: 155 });
    expect(estimate.unitCost?.p50).toBe(30);
  });

  it("estimates by session when asked", () => {
    const cube = cubeOf([1, 2, 3, 4, 5].map((n) => day(`2026-10-0${n}`, n * 10, { sessionKey: `p:s${n}` })));
    expect(buildCostEstimate(cube, { ...query, unit: "sessions", planned: 3 })).toMatchObject({ unit: "sessions", range: { p50: 90, p90: 138 } });
  });

  it("gives no range, only the reason, under five known active days (D18)", () => {
    const cube = cubeOf([day("2026-10-01", 10), day("2026-10-02", 20), day("2026-10-03", 0, { cost: costs({ priced: unknownFigure("no price") }) })]);
    const estimate = costEstimateSchema.parse(buildCostEstimate(cube, query));
    expect(estimate).toMatchObject({ range: null, unitCost: null, refusal: "Only 2 active days with a known cost in the last 12 weeks; an estimate needs at least 5. 1 more active day had a turn with no price." });
  });

  it("reads only the target's turns inside the window", () => {
    const cube = cubeOf([
      ...[1, 2, 3, 4, 5].map((n) => day(`2026-10-0${n}`, 10)),
      day("2026-10-06", 999, { projectId: "other" }),
      day("2026-08-14", 999), // before the 12-week window
    ]);
    expect(buildCostEstimate(cube, query).history).toMatchObject({ units: 5, totalUsd: 50 });
    expect(buildCostEstimate(cube, { ...query, weeks: 4 }).window).toEqual({ weeks: 4, since: "2026-10-10", until: "2026-11-06" });
  });

  it("can target a repository", () => {
    const cube = cubeOf([1, 2, 3, 4, 5].map((n) => day(`2026-10-0${n}`, 10, { repositoryKey: "github.com/acme/app" })));
    expect(buildCostEstimate(cube, { ...query, target: { groupBy: "repository", id: "github.com/acme/app", name: "github.com/acme/app" } }).history.knownUnits).toBe(5);
  });

  // Phase 14 step 14.5 (D7): the same estimate over another figure per turn
  // (the simulated one), its rows the target's in the window.
  it("estimates from another figure per turn when given one, with the same rules", () => {
    const rows = [1, 2, 3, 4, 5].map((n) => day(`2026-10-0${n}`, 1000));
    const outside = day("2026-01-01", 1);
    const cube = cubeOf([...rows, outside]);
    const asked: string[] = [];
    const halfOf = (row: (typeof rows)[number]) => (asked.push(row.turnKey), priced(n(row) * 5, "sim"));
    const n = (row: (typeof rows)[number]) => Number(row.date.slice(-1));

    const estimate = costEstimateSchema.parse(buildCostEstimate(cube, query, halfOf));

    expect(estimate).toMatchObject({ history: { units: 5, knownUnits: 5, totalUsd: 75 }, unitCost: { p50: 15, p90: 23 } });
    expect(asked.sort()).toEqual(rows.map((row) => row.turnKey).sort());
    expect(estimateRows(cube, query).map((row) => row.turnKey)).toEqual(rows.map((row) => row.turnKey));
  });
});
