// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { COST_FIXTURE_RANGE, costTotal, sampleCostSeries, THREE_PROJECTS } from "../../test-support/cost-fixture.js";
import { chartLines, costKpis, groupPriceMarkers, indexedLines, nativeCurrencies, runningTotalLine } from "./series-model.js";
import { SeriesPalette, seriesStyle } from "./series-colors.js";

const palette = new SeriesPalette(["portal", "billing", "tools"]);

describe("chartLines: a cost series as lines to draw (plan §11.2)", () => {
  const series = sampleCostSeries();

  it("keeps each line's key, label and fixed colour, in the shown unit", () => {
    const lines = chartLines(series, { palette, unit: "AI_CREDITS" });
    expect(lines.map((line) => [line.key, line.label])).toEqual([
      ["portal", "Customer portal"],
      ["billing", "Billing service"],
      ["tools", "Internal tools"],
    ]);
    expect(lines[2]!.style).toEqual(seriesStyle(2));
    expect(lines[0]!.points[0]!.value).toBeCloseTo(38);
    expect(chartLines(series, { palette, unit: "USD" })[0]!.points[0]!.value).toBeCloseTo(0.38);
  });

  it("draws a bucket with turns but no known cost as a gap (null), never 0, and an idle bucket as 0", () => {
    const tools = chartLines(series, { palette, unit: "AI_CREDITS" })[2]!;
    const gap = tools.points[7]!;
    expect(gap.value).toBeNull();
    expect(gap.turns).toBe(12);
    expect(gap.knownTurns).toBe(0);
    const idle = tools.points[13]!;
    expect(idle.turns).toBe(0);
    expect(idle.value).toBe(0);
  });

  it("marks a partly covered bucket", () => {
    const tools = chartLines(series, { palette, unit: "AI_CREDITS" })[2]!;
    expect(tools.points[10]!.partial).toBe(true);
    expect(tools.points[9]!.partial).toBe(false);
  });

  it("keeps only the lines the scope names, and shows a local repository by its folder", () => {
    const repoSeries = sampleCostSeries(
      [
        { key: "local:scratch", label: "local:scratch", values: [1, 2] },
        { key: null, label: "Unattributed", values: [3, 4] },
        { key: "github.com/acme/a", label: "github.com/acme/a", values: [5, 6] },
      ],
      { groupBy: "repository" },
    );
    const lines = chartLines(repoSeries, { palette, unit: "AI_CREDITS", scope: { groupBy: "repository", keep: ["local:/home/dev/scratch", null] } });
    expect(lines.map((line) => line.label)).toEqual(["scratch", "Unattributed"]);
  });
});

describe("costKpis (plan §11.2 KPI tiles)", () => {
  it("totals the shown lines with their coverage, and never presents a partial total as complete", () => {
    const lines = chartLines(sampleCostSeries(), { palette, unit: "AI_CREDITS" });
    const kpis = costKpis(lines, undefined, COST_FIXTURE_RANGE, { palette, unit: "AI_CREDITS" });
    const expected = [...THREE_PROJECTS[0]!.values, ...THREE_PROJECTS[1]!.values, ...THREE_PROJECTS[2]!.values].reduce<number>((sum, value) => sum + (value ?? 0), 0);
    expect(kpis.total).toBeCloseTo(expected);
    expect(kpis.coverage.turns).toBe(39 * 12);
    expect(kpis.coverage.knownTurns).toBe(39 * 12 - 12 - 2);
    expect(kpis.change).toBeNull();
    expect(kpis.activeDays).toBeNull();
  });

  it("compares with the previous period and counts active days from the day-by-day summary", () => {
    const lines = chartLines(sampleCostSeries([{ key: "portal", label: "Customer portal", values: [10, 20] }], { bucket: "day", range: { since: "2026-11-01", until: "2026-11-02" } }), {
      palette,
      unit: "AI_CREDITS",
    });
    const summary = sampleCostSeries([{ key: "portal", label: "Customer portal", values: [5, 0, 10, 20] }], {
      bucket: "day",
      range: { since: "2026-10-30", until: "2026-11-02" },
    });
    // The previous period's second day had turns at 0 credits.
    const kpis = costKpis(lines, summary, { since: "2026-11-01", until: "2026-11-02" }, { palette, unit: "AI_CREDITS" });
    expect(kpis.total).toBeCloseTo(30);
    expect(kpis.previous).toBeCloseTo(5);
    expect(kpis.change).toBeCloseTo(5);
    expect(kpis.activeDays).toBe(2);
    expect(kpis.perActiveDay).toBeCloseTo(15);
  });

  it("leaves the change unknown when nothing in the previous period is known", () => {
    const lines = chartLines(sampleCostSeries([{ key: "portal", label: "P", values: [10] }], { bucket: "day", range: { since: "2026-11-02", until: "2026-11-02" } }), {
      palette,
      unit: "AI_CREDITS",
    });
    const summary = sampleCostSeries([{ key: "portal", label: "P", values: [null, 10] }], { bucket: "day", range: { since: "2026-11-01", until: "2026-11-02" } });
    const kpis = costKpis(lines, summary, { since: "2026-11-02", until: "2026-11-02" }, { palette, unit: "AI_CREDITS" });
    expect(kpis.previous).toBeNull();
    expect(kpis.change).toBeNull();
  });
});

describe("runningTotalLine", () => {
  it("adds up the known amounts bucket by bucket, holding level over a gap", () => {
    const tools = chartLines(sampleCostSeries(), { palette, unit: "AI_CREDITS" })[2]!;
    const running = runningTotalLine(tools);
    expect(running.points[1]!.value).toBeCloseTo(22);
    expect(running.points[7]!.value).toBeCloseTo(running.points[6]!.value!);
  });
});

describe("indexedLines (plan §8.2: first period = 100)", () => {
  it("indexes each line to its first known, non-zero bucket and keeps gaps", () => {
    const [portal, , tools] = indexedLines(chartLines(sampleCostSeries(), { palette, unit: "AI_CREDITS" }));
    expect(portal!.points[0]!.value).toBeCloseTo(100);
    expect(portal!.points[12]!.value).toBeCloseTo((61 / 38) * 100);
    expect(tools!.points[7]!.value).toBeNull();
  });

  it("starts a line at its base bucket, with nothing drawn before it", () => {
    const lines = chartLines(sampleCostSeries([{ key: "x", label: "X", values: [0, 0, 5, 10] }]), { palette, unit: "AI_CREDITS" });
    expect(indexedLines(lines)[0]!.points.slice(0, 4).map((point) => point.value)).toEqual([null, null, 100, 200]);
  });

  it("gives a line with no known base no points to draw", () => {
    const lines = chartLines(sampleCostSeries([{ key: "x", label: "X", values: [null, null] }]), { palette, unit: "AI_CREDITS" });
    expect(indexedLines(lines)[0]!.points.every((point) => point.value === null)).toBe(true);
  });
});

describe("price markers and currencies", () => {
  it("groups markers of one model on one date across channels", () => {
    const marker = sampleCostSeries().priceChanges[0]!;
    const groups = groupPriceMarkers([marker, { ...marker, channel: "anthropic-api" }, { ...marker, modelId: "gpt-6.1-sol", date: "2026-10-20" }]);
    expect(groups.map((group) => [group.date, group.modelId, group.markers.length])).toEqual([
      ["2026-10-07", "claude-sonnet-5.5", 2],
      ["2026-10-20", "gpt-6.1-sol", 1],
    ]);
    expect(groups[0]!.label).toBe("Price · claude-sonnet-5.5 −50%");
  });

  it("lists the native currencies behind the shown lines", () => {
    const lines = chartLines(sampleCostSeries(), { palette, unit: "AI_CREDITS" });
    expect(nativeCurrencies(lines)).toEqual(["AI_CREDITS", "USD"]);
    expect(costTotal(1).amounts[0]!.currency).toBe("AI_CREDITS");
  });
});

// Step 15.10 (plan §6.4 point 2, §11.2): observed changes are markers of
// their own kind (dashed), labelled as observed.
describe("observedMarkerGroups", () => {
  it("makes one observed group per change, labelled with its size and direction", async () => {
    const { observedMarkerGroups } = await import("./series-model.js");
    const groups = observedMarkerGroups([
      {
        kind: "observed",
        date: "2026-10-05",
        channel: "github-copilot",
        modelId: "gpt-5.5",
        direction: "above",
        percent: 12,
        weeks: [],
        priceVersionIds: [],
        confidence: "inferred",
      },
    ] as never);
    expect(groups).toEqual([expect.objectContaining({ kind: "observed", date: "2026-10-05", modelId: "gpt-5.5", label: "Observed · gpt-5.5 +12%", markers: [] })]);
  });
});
