// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HorizontalBars } from "./HorizontalBars.js";

const series = [
  { id: "ok", label: "Succeeded", color: "var(--color-status-success)" },
  { id: "failed", label: "Failed", color: "var(--color-status-error)" },
];

describe("HorizontalBars", () => {
  it("renders one row per entry with its total at the bar tip", () => {
    render(
      <HorizontalBars
        ariaLabel="Programs"
        series={series}
        rows={[
          { key: "npm", label: "npm", values: { ok: 9, failed: 3 } },
          { key: "git", label: "git", values: { ok: 6, failed: 0 } },
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "npm 12: 9 Succeeded, 3 Failed" })).toHaveTextContent("12");
    expect(screen.getByRole("button", { name: "git 6: 6 Succeeded, 0 Failed" })).toHaveTextContent("6");
  });

  it("sizes segments relative to the largest row", () => {
    const { container } = render(
      <HorizontalBars
        ariaLabel="x"
        series={series}
        rows={[
          { key: "a", label: "a", values: { ok: 2, failed: 2 } },
          { key: "b", label: "b", values: { ok: 1, failed: 0 } },
        ]}
      />,
    );
    const widths = [...container.querySelectorAll("[data-segment]")].map((el) => (el as HTMLElement).style.width);
    expect(widths).toEqual(["50%", "50%", "25%"]);
  });

  it("shows a legend only for more than one series", () => {
    const { rerender } = render(<HorizontalBars ariaLabel="x" series={series} rows={[]} />);
    expect(screen.getByRole("list", { name: "Legend" })).toBeInTheDocument();

    rerender(<HorizontalBars ariaLabel="x" series={[series[1]]} rows={[]} />);
    expect(screen.queryByRole("list", { name: "Legend" })).not.toBeInTheDocument();
  });

  it("calls onSelect and marks the selected row", () => {
    const onSelect = vi.fn();
    render(
      <HorizontalBars
        ariaLabel="x"
        series={[series[1]]}
        rows={[{ key: "timeout", label: "Timeout", values: { failed: 2 } }]}
        onSelect={onSelect}
        selectedKey="timeout"
      />,
    );

    const row = screen.getByRole("button", { name: "Timeout 2: 2 Failed" });
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith("timeout");
    expect(row).toHaveAttribute("aria-pressed", "true");
  });

  it("offers the same rows as a captioned table, with totals and unknown for a missing value", () => {
    render(
      <HorizontalBars
        ariaLabel="Programs"
        series={series}
        rows={[
          { key: "npm", label: "npm", values: { ok: 9, failed: 3 } },
          { key: "git", label: "git", values: { ok: 6 } },
        ]}
      />,
    );
    const toggle = screen.getByRole("button", { name: "View as table" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-pressed", "true");
    const table = screen.getByRole("table", { name: "Programs" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Category", "Succeeded", "Failed", "Total"]);
    expect(within(within(table).getByRole("rowheader", { name: "npm" }).closest("tr")!).getAllByRole("cell").map((c) => c.textContent)).toEqual(["9", "3", "12"]);
    expect(within(within(table).getByRole("rowheader", { name: "git" }).closest("tr")!).getAllByRole("cell").map((c) => c.textContent)).toEqual(["6", "unknown", "6"]);
    expect(screen.getByRole("group", { name: "Programs" })).toBeInTheDocument();
  });

  it("has no toggle without rows", () => {
    render(<HorizontalBars ariaLabel="x" series={series} rows={[]} />);
    expect(screen.queryByRole("button", { name: "View as table" })).not.toBeInTheDocument();
  });

  it("renders an empty state", () => {
    render(<HorizontalBars ariaLabel="x" series={series} rows={[]} emptyText="Nothing failed." />);
    expect(screen.getByText("Nothing failed.")).toBeInTheDocument();
  });
  // Step 15.9: the Compare tab's share-of-total bars write shares, not counts.
  it("formats values, totals and table cells with the given format", () => {
    render(
      <HorizontalBars
        ariaLabel="Share of total"
        series={[{ id: "portal", label: "Customer portal", color: "var(--color-series-1)" }]}
        rows={[{ key: "portal", label: "Customer portal", values: { portal: 0.527 } }]}
        format={(value) => `${(value * 100).toFixed(1)}%`}
      />,
    );
    expect(screen.getByRole("button", { name: "Customer portal 52.7%" })).toHaveTextContent("52.7%");
    fireEvent.click(screen.getByRole("button", { name: "View as table" }));
    expect(within(screen.getByRole("table", { name: "Share of total" })).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["52.7%", "52.7%"]);
  });
});

// Step 10.17 G7 (check 1.8): stacked segments differ by more than colour.
describe("HorizontalBars patterns", () => {
  const stacked = [
    { id: "a", label: "Uncached", color: "var(--color-series-1)" },
    { id: "b", label: "Cache read", color: "var(--color-series-3)" },
    { id: "c", label: "Output", color: "var(--color-series-2)" },
  ];

  it("hatches every stacked series but the first, each differently", () => {
    const { container } = render(<HorizontalBars ariaLabel="Tokens" series={stacked} rows={[{ key: "m", label: "model", values: { a: 3, b: 2, c: 1 } }]} />);
    const images = ["a", "b", "c"].map((id) => (container.querySelector(`[data-segment="${id}"]`) as HTMLElement).style.backgroundImage);
    expect(images[0]).toBe("");
    expect(images[1]).not.toBe("");
    expect(images[2]).not.toBe("");
    expect(images[1]).not.toBe(images[2]);
  });

  it("keeps a single series solid", () => {
    const { container } = render(<HorizontalBars ariaLabel="One" series={[stacked[1]!]} rows={[{ key: "m", label: "model", values: { b: 2 } }]} />);
    expect((container.querySelector('[data-segment="b"]') as HTMLElement).style.backgroundImage).toBe("");
  });

  it("uses a series' own pattern when it names one (a status keeps it across charts)", () => {
    const { container } = render(
      <HorizontalBars
        ariaLabel="Status"
        series={[
          { id: "ok", label: "Succeeded", color: "var(--color-status-success)", pattern: "solid" },
          { id: "bad", label: "Failed", color: "var(--color-status-error)", pattern: "diagonal" },
        ]}
        rows={[{ key: "t", label: "tool", values: { ok: 1, bad: 1 } }]}
      />,
    );
    expect((container.querySelector('[data-segment="bad"]') as HTMLElement).style.backgroundImage).toContain("repeating-linear-gradient");
  });
});
