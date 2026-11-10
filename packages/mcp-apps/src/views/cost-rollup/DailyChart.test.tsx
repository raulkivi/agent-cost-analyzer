// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CostRollupViewModel } from "../../view-models/index.js";
import { DailyChart } from "./DailyChart.js";

const daily = (count: number): CostRollupViewModel["daily"] =>
  ({
    maxValue: 10,
    maxText: "10",
    points: Array.from({ length: count }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, label: `Oct ${i + 1}`, value: i + 1, text: String(i + 1), unknown: false })),
  }) as unknown as CostRollupViewModel["daily"];

// At the narrowest font (18 viewBox units) "Oct 28" is about 60 units wide, so (with a gap)
// neighbouring date labels need at least that much room on the 532-unit plot.
describe("DailyChart date labels", () => {
  it.each([7, 14, 30])("keeps %i days' labels apart at the narrow font size", (count) => {
    const { container } = render(<DailyChart daily={daily(count)} formatValue={String} />);
    const labels = [...container.querySelectorAll("text.view-chart-axis")].filter((node) => /^Oct/.test(node.textContent ?? ""));
    expect(labels.length).toBeGreaterThan(0);
    const xs = labels.map((node) => Number(node.getAttribute("x")));
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(80);
  });
});
