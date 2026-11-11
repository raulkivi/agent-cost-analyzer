// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { basisTotals, costSeries, costTotal, point, projectCost, usdTotal } from "./cost-analysis-fixtures.js";
import { toCostSeriesViewModel } from "./cost-series.js";

describe("toCostSeriesViewModel header", () => {
  it("titles a repository by the folder name the tool returns, never a derived path", () => {
    const vm = toCostSeriesViewModel(costSeries({ ids: ["/home/me/src/widgets"], series: [{ ...costSeries().series[0]!, key: "/home/me/src/widgets", label: "widgets" }] }));
    expect(vm.kind).toBe("repository");
    expect(vm.title).toBe("widgets");
    expect(JSON.stringify(vm)).not.toContain("/home/me");
  });

  it("falls back to a generic title when no series came back", () => {
    expect(toCostSeriesViewModel(costSeries({ series: [], ids: ["/home/me/src/widgets"] })).title).toBe("Repository");
  });

  it("titles a project by its name", () => {
    const vm = toCostSeriesViewModel(projectCost());
    expect(vm).toMatchObject({ kind: "project", title: "Acme platform", projectId: "p1" });
  });

  it("states the period, bucket, basis and pricing", () => {
    const vm = toCostSeriesViewModel(costSeries());
    expect(vm).toMatchObject({ periodText: "Oct 1 – Nov 9", bucketText: "monthly", basisText: "preferred (billed, else reported, else priced)", pricingText: "prices as of use" });
    expect(toCostSeriesViewModel(costSeries({ pricing: "today", bucket: "week" }))).toMatchObject({ pricingText: "today's prices", bucketText: "weekly" });
  });

  it("states the conversion only for a usd view", () => {
    expect(toCostSeriesViewModel(costSeries()).conversionNote).toBeUndefined();
    expect(toCostSeriesViewModel(costSeries({ currency: "usd" })).conversionNote).toContain("1 AI Credit = $0.01");
  });
});

describe("toCostSeriesViewModel totals", () => {
  it("gives one tile per basis, each with its basis name, unit and coverage", () => {
    const { basisTiles, total } = toCostSeriesViewModel(costSeries());
    expect(total[0]).toMatchObject({ text: "100.00 AI Credits", basis: "preferred", coverageNote: "known for 38 of 46 turns" });
    expect(basisTiles.map((tile) => tile.basis)).toEqual(["preferred", "billed", "reported", "priced"]);
    expect(basisTiles[1]?.money[0]).toMatchObject({ text: "90.00 AI Credits", basis: "billed", coverageNote: "known for 30 of 46 turns" });
    expect(basisTiles[3]?.money[0]).toMatchObject({ text: "110.00 AI Credits", basis: "priced", estimate: true });
  });

  it("shows a basis with nothing known as Unknown with the reason, never 0", () => {
    const reported = toCostSeriesViewModel(costSeries()).basisTiles[2]!;
    expect(reported.money[0]).toMatchObject({ text: "Unknown", known: false, basis: "reported" });
    expect(reported.money[0]?.unknownNote).toBe("no reported figure for any of 46 turns");
  });

  it("says how the preferred basis was made up", () => {
    expect(toCostSeriesViewModel(costSeries()).basisTiles[0]?.basisNote).toBe("billed for 30 turns, priced for 8, no figure for 8");
  });

  it("keeps currencies apart unless the view is in usd", () => {
    const mixed = { ...costTotal(10, 5, 5), amounts: [{ currency: "AI_CREDITS" as const, amount: 10, knownTurns: 5 }, { currency: "USD" as const, amount: 4, knownTurns: 5 }] };
    const native = toCostSeriesViewModel(costSeries({ total: mixed }));
    expect(native.total.map((money) => money.text)).toEqual(["10.00 AI Credits", "$4.00"]);
    const usd = toCostSeriesViewModel(costSeries({ currency: "usd", total: usdTotal(0.14, 5, 5), totals: basisTotals({ preferred: costTotal(14, 5, 5) }) }));
    expect(usd.total.map((money) => money.text)).toEqual(["$0.14"]);
    expect(usd.basisTiles[0]?.money.map((money) => money.text)).toEqual(["$0.14"]);
  });

  it("surfaces turns in no bucket and provider problems", () => {
    const vm = toCostSeriesViewModel(
      costSeries({
        providers: [
          { id: "pi", label: "pi", available: false, unavailableReason: "no logs found", sessionCount: 0, truncated: false },
          { id: "copilot", label: "Copilot Chat", available: true, sessionCount: 500, truncated: true },
        ],
      }),
    );
    expect(vm.undatedNote).toBe("2 turns have no date and are in no bucket");
    expect(vm.providerIssues).toEqual(["pi: no logs found", "Copilot Chat: more sessions matched than the limit; the figures cover the most recent ones"]);
    expect(toCostSeriesViewModel(costSeries({ undatedTurns: 0, providers: [] })).undatedNote).toBeUndefined();
  });
});

describe("toCostSeriesViewModel chart", () => {
  it("draws a bucket with nothing known as a gap, not 0", () => {
    const { chart } = toCostSeriesViewModel(costSeries());
    expect(chart.currencies).toEqual(["AI_CREDITS"]);
    expect(chart.points.map((p) => p.label)).toEqual(["2026-10", "2026-11"]);
    expect(chart.points[0]).toMatchObject({ unknown: false, turns: 40 });
    expect(chart.points[0]?.cost[0]).toMatchObject({ amount: 100, text: "100.00 AI Credits" });
    expect(chart.points[1]).toMatchObject({ unknown: true });
    expect(chart.points[1]?.cost[0]).toMatchObject({ amount: null, text: "Unknown" });
    expect(chart.points[1]?.cumulative[0]?.amount).toBe(100);
  });

  // mcp-apps.md §9.1 answer 5: AI Credits first, then USD, whichever currency the first bucket knows.
  it("lists the currencies AI Credits first, then USD, even when the first bucket has only USD", () => {
    const usdOnly = usdTotal(0.5, 3, 3);
    const both = { ...costTotal(10, 5, 5), amounts: [{ currency: "AI_CREDITS" as const, amount: 10, knownTurns: 5 }, { currency: "USD" as const, amount: 4, knownTurns: 5 }] };
    const base = costSeries();
    const series = { ...base, points: [point("2026-09", "2026-09-01", "2026-09-30", usdOnly, usdOnly), point("2026-10", "2026-10-01", "2026-10-31", both, both)] };
    expect(toCostSeriesViewModel(series).chart.currencies).toEqual(["AI_CREDITS", "USD"]);
  });

  it("labels day buckets by day", () => {
    const base = costSeries();
    const vm = toCostSeriesViewModel(costSeries({ bucket: "day", points: [{ ...base.points[0]!, period: "2026-10-07", start: "2026-10-07", end: "2026-10-07" }] }));
    expect(vm.chart.points[0]?.label).toBe("Oct 7");
  });

  it("labels week buckets by the day the week starts, as the board does", () => {
    const base = costSeries();
    const vm = toCostSeriesViewModel(costSeries({ bucket: "week", points: [{ ...base.points[0]!, period: "2026-W32", start: "2026-08-03", end: "2026-08-09" }] }));
    expect(vm.chart.points[0]?.label).toBe("Aug 3");
  });
});

describe("toCostSeriesViewModel price-change markers", () => {
  it("keeps observed changes distinct from documented ones, in date order", () => {
    const { markers } = toCostSeriesViewModel(costSeries());
    expect(markers.map((marker) => marker.kind)).toEqual(["documented", "observed"]);
    expect(markers[0]).toMatchObject({ kind: "documented", inferred: false, dateText: "Oct 15", modelId: "claude-sonnet-5.5", period: "2026-10" });
    expect(markers[1]).toMatchObject({ kind: "observed", inferred: true, label: "inferred", modelId: "gpt-6.1-sol", period: "2026-10" });
  });

  it("describes documented changes per token type and observed ones as billed above or below the price book", () => {
    const [documented, observed] = toCostSeriesViewModel(costSeries()).markers;
    expect(documented).toMatchObject({
      lines: [
        { tokenText: "input", fromText: "$3.00 / 1M", toText: "$4.00 / 1M", percentText: "+33.33 %" },
        { tokenText: "cache write", fromText: "none", toText: "$5.00 / 1M" },
      ],
    });
    expect(documented && "lines" in documented && documented.lines[1]?.percentText).toBeUndefined();
    expect(observed).toMatchObject({ direction: "above", percentText: "+12 %", weeksText: "2 weeks in a row" });
  });

  it("has no markers when nothing changed", () => {
    expect(toCostSeriesViewModel(costSeries({ priceChanges: [], observedChanges: [] })).markers).toEqual([]);
  });
});

describe("toCostSeriesViewModel breakdown", () => {
  it("lists vendors then models with their cost", () => {
    const { byVendor } = toCostSeriesViewModel(costSeries());
    expect(byVendor[0]).toMatchObject({ label: "Anthropic", turnsText: "30 turns" });
    expect(byVendor[0]?.money[0]?.text).toBe("70.00 AI Credits");
    expect(byVendor[0]?.models[0]).toMatchObject({ label: "claude-sonnet-5.5" });
    expect(byVendor[1]).toMatchObject({ label: "Unknown vendor", reason: "model not in the price book" });
    expect(byVendor[1]?.money[0]).toMatchObject({ text: "Unknown", known: false });
  });

  it("has no project part for a repository", () => {
    expect(toCostSeriesViewModel(costSeries()).project).toBeUndefined();
  });
});

describe("toCostSeriesViewModel project", () => {
  it("lists repositories and tokens per model by type with coverage, unknown as Unknown", () => {
    const { project } = toCostSeriesViewModel(projectCost());
    expect(project?.byRepository[0]).toMatchObject({ label: "widgets" });
    const row = project?.byTokenType[0];
    expect(row).toMatchObject({ model: "claude-sonnet-5.5" });
    expect(row?.cacheWrite).toMatchObject({ text: "Unknown", known: false });
    expect(row?.cacheRead).toEqual({ text: "250 k", known: true, estimate: false, coverageNote: "known for 20 of 46 turns" });
    expect(row?.output).toMatchObject({ text: "64 k", estimate: true });
  });

  it("carries session id and provider for a drill-down into get_session_cost", () => {
    const row = toCostSeriesViewModel(projectCost()).project?.topSessions[0];
    expect(row).toMatchObject({
      providerId: "copilot",
      sessionId: "7f3a9c2e",
      model: "claude-sonnet-5.5",
      turnsText: "42 turns",
      startedText: "Oct 27",
      drillDown: { tool: "get_session_cost", arguments: { sessionId: "7f3a9c2e", provider: "copilot" } },
    });
    expect(row?.cost[0]).toMatchObject({ text: "18.42 AI Credits", basis: "preferred", coverageNote: "known for 40 of 42 turns" });
  });

  it("keeps the logged session title under the display-only field", () => {
    const vm = toCostSeriesViewModel(projectCost());
    const { displayOnly, ...rest } = vm.project!.topSessions[0]!;
    expect(displayOnly).toEqual({ title: "Refactor provider registry" });
    expect(JSON.stringify(rest)).not.toContain("Refactor provider registry");
  });
});

describe("toCostSeriesViewModel shares", () => {
  const vendor = (key: string | null, label: string, credits: number | null, models: ReturnType<typeof costSeries>["byVendor"][number]["models"] = []) => ({
    key,
    label,
    sessions: 1,
    turns: 10,
    cost: costTotal(credits, credits === null ? 0 : 10, 10),
    coverage: { preferred: { turns: 10, knownTurns: 10 }, billed: { turns: 10, knownTurns: 10 }, reported: { turns: 10, knownTurns: 0 }, priced: { turns: 10, knownTurns: 10 } },
    models,
  });

  it("gives each vendor and model its share of the known total, per currency", () => {
    const model = { key: "claude-sonnet-5.5", label: "claude-sonnet-5.5", sessions: 1, turns: 10, cost: costTotal(25, 10, 10), coverage: vendor("x", "x", 1).coverage };
    const { byVendor } = toCostSeriesViewModel(costSeries({ byVendor: [vendor("a", "Anthropic", 75, [model]), vendor("o", "OpenAI", 25)] }));
    expect(byVendor[0]?.shares).toEqual({ AI_CREDITS: "75 %" });
    expect(byVendor[0]?.models[0]?.shares).toEqual({ AI_CREDITS: "25 %" });
    expect(byVendor[1]?.shares).toEqual({ AI_CREDITS: "25 %" });
  });

  it("gives an unknown row no share, and leaves it out of the total", () => {
    const { byVendor } = toCostSeriesViewModel(costSeries({ byVendor: [vendor("a", "Anthropic", 50), vendor(null, "Unknown vendor", null)] }));
    expect(byVendor[0]?.shares).toEqual({ AI_CREDITS: "100 %" });
    expect(byVendor[1]?.shares).toEqual({});
  });

  it("gives no share when the known total is 0 (no division)", () => {
    const { byVendor } = toCostSeriesViewModel(costSeries({ byVendor: [vendor("a", "Anthropic", 0)] }));
    expect(byVendor[0]?.shares).toEqual({});
  });
});
