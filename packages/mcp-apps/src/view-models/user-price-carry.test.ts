// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { comparisonRow, costComparison, costSeries, costTotal, costVariance, point, projectCost } from "./cost-analysis-fixtures.js";
import { toCostComparisonViewModel } from "./cost-comparison.js";
import { toCostSeriesViewModel } from "./cost-series.js";
import { toCostVarianceViewModel } from "./cost-variance.js";
import { toEstimateViewModel } from "./estimate.js";
import { estimate, statement } from "./increment3-fixtures.js";
import { savingsOutput, row } from "./savings-fixtures.js";
import { toSavingsViewModel } from "./savings.js";
import { toStatementViewModel } from "./statement.js";

// 1.0 V2b (threat-model 5.10): each view model carries the user-added price
// versions of the figures it shows, and only those; billed, reported and
// unknown figures never do.

const MINE = ["mine-2026-10"];
const mine = (low: number, high: number) => ({ known: true as const, currency: "AI_CREDITS" as const, low, high, basis: "priced" as const, label: "range" as const, priceVersionIds: MINE, userPriceVersionIds: MINE });
const priced = (credits: number, ids: string[] = MINE) => ({ ...costTotal(credits, 10, 10), userPriceVersionIds: ids });

describe("cost series (U9, U10)", () => {
  const week = point("2026-W42", "2026-10-12", "2026-10-18", priced(26.2), priced(26.2));
  const view = toCostSeriesViewModel(costSeries({ points: [week], totals: { ...costSeries().totals, priced: priced(26.2), preferred: priced(26.2) } }));

  it("carries the ids on the preferred and priced tiles and on the chart points", () => {
    expect(view.basisTiles.find((tile) => tile.basis === "priced")?.money[0]?.userPriceVersionIds).toEqual(MINE);
    expect(view.basisTiles.find((tile) => tile.basis === "preferred")?.money[0]?.userPriceVersionIds).toEqual(MINE);
    expect(view.chart.points[0]?.cost[0]?.userPriceVersionIds).toEqual(MINE);
  });

  it("never carries them on the billed or reported tiles", () => {
    for (const basis of ["billed", "reported"] as const) {
      for (const money of view.basisTiles.find((tile) => tile.basis === basis)?.money ?? []) expect(money).not.toHaveProperty("userPriceVersionIds");
    }
  });

  it("carries them on a project's vendor rows and sessions", () => {
    const base = projectCost();
    const project = toCostSeriesViewModel(
      projectCost({
        byVendor: base.byVendor.map((vendor) => ({ ...vendor, cost: priced(5) })),
        topSessions: base.topSessions.map((session) => ({ ...session, cost: priced(5) })),
      }),
    );
    expect(project.byVendor[0]?.money[0]?.userPriceVersionIds).toEqual(MINE);
    expect(project.project?.topSessions[0]?.cost[0]?.userPriceVersionIds).toEqual(MINE);
  });
});

describe("cost comparison (U11)", () => {
  it("carries the ids on a row's total, its per-session, per-day and per-turn figures and the grand total", () => {
    const model = toCostComparisonViewModel(costComparison({ total: priced(160), rows: [comparisonRow({ total: priced(100) })] }));
    const row = model.rows[0]!;
    for (const money of [row.total[0], row.perSession[0], row.perActiveDay[0], row.perTurn[0], model.total[0]]) expect(money?.userPriceVersionIds).toEqual(MINE);
  });

  it("never carries them on a billed total", () => {
    const model = toCostComparisonViewModel(costComparison({ basis: "billed" }));
    expect(model.rows[0]?.total[0]).not.toHaveProperty("userPriceVersionIds");
    expect(model.rows[0]?.perSession[0]).not.toHaveProperty("userPriceVersionIds");
  });
});

describe("cost change (U11)", () => {
  it("carries the variance's ids", () => {
    expect(toCostVarianceViewModel(costVariance({ userPriceVersionIds: MINE })).userPriceVersionIds).toEqual(MINE);
  });

  it("has none when the variance has none", () => {
    expect(toCostVarianceViewModel(costVariance())).not.toHaveProperty("userPriceVersionIds");
  });
});

describe("statement (U14)", () => {
  const base = statement();
  const userLine = { ...base.lines[0]!, userPriced: true as const, priceVersionId: "mine-1" };
  const view = toStatementViewModel({ statement: { ...base, lines: [userLine, ...base.lines.slice(1)] }, canIssue: { ok: true }, issuedPeriods: [] });

  it("carries the version on a user-priced line and on its currency's total", () => {
    expect(view.lines.find((line) => line.key === userLine.key)?.userPriceVersionIds).toEqual(["mine-1"]);
    expect(view.totals.find((total) => total.currency === userLine.currency)?.userPriceVersionIds).toEqual(["mine-1"]);
  });

  it("never carries it on billed lines or on a currency without a user-priced line", () => {
    for (const line of view.lines.filter((entry) => entry.key !== userLine.key)) expect(line).not.toHaveProperty("userPriceVersionIds");
    expect(view.totals.filter((total) => total.currency !== userLine.currency)[0]).not.toHaveProperty("userPriceVersionIds");
  });
});

describe("estimate (U15)", () => {
  it("carries the estimate's ids, and none when it has none", () => {
    expect(toEstimateViewModel(estimate({ userPriceVersionIds: MINE })).userPriceVersionIds).toEqual(MINE);
    expect(toEstimateViewModel(estimate())).not.toHaveProperty("userPriceVersionIds");
  });
});

describe("savings (U18)", () => {
  it("carries the ids of a priced amount on its row, and none on an unpriced or bundled one", () => {
    const user = row({ key: "u", kind: "idle-cache-expiry", subject: "claude-sonnet-5.5", perWeek: mine(1, 2), perWindow: mine(4, 8) });
    const model = toSavingsViewModel(savingsOutput({ opportunities: [user, row({ key: "b", kind: "idle-cache-expiry", subject: "gpt-5.5" })], opportunitiesTotal: 2 }));
    const rows = model.groups.flatMap((group) => group.rows);
    expect(rows.find((entry) => entry.key === "u")?.userPriceVersionIds).toEqual(MINE);
    expect(rows.find((entry) => entry.key === "b")).not.toHaveProperty("userPriceVersionIds");
  });
});
