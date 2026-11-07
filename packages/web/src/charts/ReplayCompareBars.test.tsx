// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axeViolations } from "../test-support/axe.js";
import { niceScale, ReplayCompareBars, type ReplayCompareBar } from "./ReplayCompareBars.js";

const usd = (value: number) => `$${value.toFixed(2)}`;

const BARS: ReplayCompareBar[] = [
  { key: "opus", label: "claude-opus-5.5", sublabel: "Measured model", value: 4.79, isMeasuredModel: true },
  { key: "gpt", label: "gpt-6.1-sol", sublabel: "OpenAI API", value: 3.36, isMeasuredModel: false },
  { key: "grok", label: "grok-4.7", sublabel: "xAI API", value: null, isMeasuredModel: false, unknownReason: "replayed, but not priced" },
];

function renderBars(bars = BARS, measured: number | null = 4.82) {
  return render(<ReplayCompareBars ariaLabel="Simulated total per model" bars={bars} measured={measured} format={usd} />);
}

describe("niceScale", () => {
  it("rounds the top up to a readable tick and starts at zero", () => {
    expect(niceScale(4.82)).toEqual({ max: 5, ticks: [0, 1, 2, 3, 4, 5] });
    expect(niceScale(11.69)).toEqual({ max: 15, ticks: [0, 5, 10, 15] });
    expect(niceScale(0)).toEqual({ max: 1, ticks: [0, 0.2, 0.4, 0.6, 0.8, 1] });
  });
});

describe("ReplayCompareBars", () => {
  it("is one image whose name reads every total, the measured one and the own model", () => {
    renderBars();
    expect(screen.getByRole("img", { name: "Simulated total per model, measured $4.82: claude-opus-5.5 (measured model) $4.79, gpt-6.1-sol $3.36, grok-4.7 unknown." })).toBeInTheDocument();
  });

  it("draws one bar per known total, sized on a zero-based scale, with its value beside it", () => {
    const { container } = renderBars();
    const bars = [...container.querySelectorAll<HTMLElement>("[data-bar]")];
    expect(bars.map((bar) => bar.dataset.bar)).toEqual(["opus", "gpt"]);
    // Scale 0..5: 4.79 → 95.8%, 3.36 → 67.2%.
    expect(bars.map((bar) => bar.style.width)).toEqual(["95.8%", "67.2%"]);
    expect(screen.getByText("$4.79")).toBeInTheDocument();
    expect(screen.getByText("$3.36")).toBeInTheDocument();
  });

  it("tells the own model apart by hatching and an outline, not by colour alone", () => {
    const { container } = renderBars();
    const own = container.querySelector<HTMLElement>('[data-bar="opus"]')!;
    const other = container.querySelector<HTMLElement>('[data-bar="gpt"]')!;
    expect(own.dataset.measuredModel).toBe("true");
    expect(own.style.backgroundImage).toContain("repeating-linear-gradient");
    expect(own.style.border).toContain("solid");
    expect(other.style.backgroundImage).toBe("");
    // Every bar has an outline, so High Contrast (no fills to rely on) still shows it.
    expect(other.style.border).toContain("solid");
    expect(screen.getByText("Measured model")).toBeInTheDocument();
  });

  it("writes an unknown total as unknown with its reason, with no bar at all", () => {
    const { container } = renderBars();
    expect(container.querySelector('[data-bar="grok"]')).toBeNull();
    const row = container.querySelector<HTMLElement>('[data-row="grok"]')!;
    expect(row).toHaveTextContent("unknown");
    expect(row).toHaveTextContent("replayed, but not priced");
    expect(row).not.toHaveTextContent("$0");
  });

  it("draws the measured total as a dashed reference line, labelled", () => {
    const { container } = renderBars();
    const line = container.querySelector<HTMLElement>("[data-reference]")!;
    expect(line.style.left).toBe("96.4%");
    expect(line.style.borderLeft).toContain("dashed");
    // Labelled on the plot and in the legend.
    expect(screen.getAllByText("Measured $4.82")).toHaveLength(2);
  });

  it("leaves the reference line out when the measured total is unknown", () => {
    const { container } = renderBars(BARS, null);
    expect(container.querySelector("[data-reference]")).toBeNull();
    expect(screen.getByRole("img", { name: /measured unknown:/ })).toBeInTheDocument();
  });

  it("has a legend for the own model's pattern and the reference line", () => {
    renderBars();
    const legend = screen.getByRole("list", { name: "Legend" });
    expect(within(legend).getByText("Other model")).toBeInTheDocument();
    expect(within(legend).getByText("Session's own model (hatched, outlined)")).toBeInTheDocument();
    expect(within(legend).getByText("Measured $4.82")).toBeInTheDocument();
  });

  it("swaps to a table of the same figures, unknown kept as unknown", () => {
    renderBars();
    fireEvent.click(screen.getByRole("button", { name: "View as table" }));
    const table = screen.getByRole("table", { name: "Simulated total per model" });
    expect(within(table).getByRole("rowheader", { name: "claude-opus-5.5 (measured model)" })).toBeInTheDocument();
    const grok = within(table).getByRole("rowheader", { name: "grok-4.7" }).closest("tr")!;
    expect(grok).toHaveTextContent("unknown");
    const measured = within(table).getByRole("rowheader", { name: "Measured" }).closest("tr")!;
    expect(measured).toHaveTextContent("$4.82");
  });

  it("has no axe violations", async () => {
    renderBars();
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
