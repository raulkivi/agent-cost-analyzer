// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TurnChart as TurnChartModel } from "../../view-models/index.js";
import { MIN_LABEL_SPACING, TurnChart, describeTurnChart, selectLabelIndices } from "./TurnChart.js";

const point = (turnIndex: number, value: number | null): TurnChartModel["points"][number] => ({
  turnIndex,
  value,
  text: value === null ? "Unknown" : value.toFixed(2),
  unknown: value === null,
  estimate: false,
  eventLabels: [],
});

const chartOf = (count: number, unknownAt: number[] = []): TurnChartModel => ({
  points: Array.from({ length: count }, (_, i) => point(i, unknownAt.includes(i) ? null : i + 1)),
  maxValue: count,
  maxText: String(count),
  title: "AI Credits per turn",
  unitLabel: "AI Credits",
});

describe("selectLabelIndices", () => {
  it("labels every turn when each has room", () => {
    expect(selectLabelIndices(4, 100, 40)).toEqual([0, 1, 2, 3]);
  });
  it("returns nothing for no turns and the only index for one", () => {
    expect(selectLabelIndices(0, 100, 40)).toEqual([]);
    expect(selectLabelIndices(1, 100, 40)).toEqual([0]);
  });
  it("thins to every Nth turn, keeping first and last, never closer than the minimum spacing", () => {
    const step = 540 / 60;
    const picked = selectLabelIndices(60, step, 40);
    expect(picked[0]).toBe(0);
    expect(picked.at(-1)).toBe(59);
    for (let i = 1; i < picked.length; i++) expect((picked[i]! - picked[i - 1]!) * step).toBeGreaterThanOrEqual(40);
    expect(picked.length).toBeLessThan(60);
  });
});

describe("MIN_LABEL_SPACING", () => {
  // The narrowest font (18 viewBox units, views.css) draws "100" about 32 units wide.
  it("leaves room for a three-digit label at the narrowest font size", () => {
    expect(MIN_LABEL_SPACING).toBeGreaterThanOrEqual(48);
  });
});

describe("TurnChart axis labels", () => {
  const labels = (container: HTMLElement) => [...container.querySelectorAll("text[data-turn-label]")].map((node) => node.textContent);

  it("labels each turn under its bar, hidden from assistive tech, including an unknown turn", () => {
    const { container } = render(<TurnChart chart={chartOf(4, [1])} />);
    expect(labels(container)).toEqual(["0", "1", "2", "3"]);
    for (const node of container.querySelectorAll("text[data-turn-label]")) {
      expect(node.getAttribute("aria-hidden")).toBe("true");
      expect(node.getAttribute("class")).toContain("view-chart-axis");
    }
  });

  it("thins labels for a long session but keeps the first and last", () => {
    const { container } = render(<TurnChart chart={chartOf(60)} />);
    const shown = labels(container);
    expect(shown.length).toBeLessThan(60);
    expect(shown[0]).toBe("0");
    expect(shown.at(-1)).toBe("59");
  });
});

describe("TurnChart measure", () => {
  const tokenChart: TurnChartModel = {
    points: [
      { turnIndex: 14, value: 5_300_000, text: "5.3 M", unknown: false, estimate: true, eventLabels: [] },
      { turnIndex: 15, value: null, text: "Unknown", unknown: true, estimate: false, eventLabels: [] },
    ],
    maxValue: 5_300_000,
    maxText: "5.3 M",
    title: "Input tokens per turn",
    unitLabel: "input tokens",
  };

  it("names the chart after its measure, for both measures", () => {
    expect(describeTurnChart(tokenChart)).toBe("Input tokens per turn, 2 turns; highest 5.3 M at turn 14; 1 turn unknown");
    expect(describeTurnChart(chartOf(4, [1]))).toBe("AI Credits per turn, 4 turns; highest 4.00 at turn 3; 1 turn unknown");
  });

  it("titles columns with the measure's unit and shows the axis maximum from the model", () => {
    const { container, getByText } = render(<TurnChart chart={tokenChart} />);
    expect(getByText("Turn 14: 5.3 M input tokens (estimate)")).toBeInTheDocument();
    expect(getByText("Turn 15: Unknown")).toBeInTheDocument();
    expect(container.querySelector("text.view-chart-axis:not([data-turn-label])")).not.toBeNull();
    expect(getByText("5.3 M", { selector: "text" })).toBeInTheDocument();
  });
});
