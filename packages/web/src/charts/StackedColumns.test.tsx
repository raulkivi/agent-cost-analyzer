// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StackedColumns, type StackedColumn } from "./StackedColumns.js";

const zero = { success: 0, error: 0, interrupted: 0, denied: 0, unknown: 0 };
const columns: StackedColumn[] = [
  { key: "0", label: "0", counts: { ...zero, success: 1, error: 9 } },
  { key: "1", label: "1", counts: { ...zero, success: 1, error: 1, interrupted: 1 } },
  { key: "2", label: "2", counts: zero },
];

describe("StackedColumns", () => {
  it("renders one focusable column per entry with an accessible summary", () => {
    render(<StackedColumns ariaLabel="Tool outcomes per turn" columns={columns} axisLabel="Turn" />);

    const column = screen.getByRole("button", { name: "Turn 1: 1 succeeded, 1 failed, 1 interrupted" });
    expect(column).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn 2: no tool calls" })).toBeInTheDocument();
  });

  it("draws one segment per non-zero status", () => {
    const { container } = render(<StackedColumns ariaLabel="x" columns={columns} axisLabel="Turn" />);
    const firstColumn = container.querySelector('[data-column="0"]')!;
    expect([...firstColumn.querySelectorAll("[data-status]")].map((el) => el.getAttribute("data-status"))).toEqual([
      "success",
      "error",
    ]);
  });

  // Step 10.17 G7 (check 1.8): success and error were 1.1:1 apart. Every
  // status but the first is drawn with its own hatch, so colour is not the only cue.
  it("draws each status in its themed colour, all but success hatched with a pattern of their own", () => {
    const { container } = render(<StackedColumns ariaLabel="x" columns={columns} axisLabel="Turn" />);
    const fills = new Map([...container.querySelectorAll("[data-status]")].map((el) => [el.getAttribute("data-status"), el.getAttribute("fill")]));
    expect(fills.get("success")).toBe("var(--color-status-success)");
    const error = fills.get("error")!;
    const interrupted = fills.get("interrupted")!;
    expect(error).toMatch(/^url\(#.+\)$/);
    expect(interrupted).toMatch(/^url\(#.+\)$/);
    expect(error).not.toBe(interrupted);
    const patternOf = (fill: string) => container.querySelector(fill.slice(4, -1))!;
    expect(patternOf(error).querySelector("rect[data-series-fill]")).toHaveAttribute("fill", "var(--color-status-error)");
    expect(patternOf(error).querySelectorAll("path, line, circle").length).toBeGreaterThan(0);
  });

  it("shows a legend with icon + label for each status present", () => {
    render(<StackedColumns ariaLabel="x" columns={columns} axisLabel="Turn" />);
    const legend = screen.getByRole("list", { name: "Legend" });
    expect(within(legend).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "✓Succeeded",
      "✕Failed",
      "⏸Interrupted",
    ]);
  });

  it("selects a column by click and by keyboard", () => {
    const onSelect = vi.fn();
    render(<StackedColumns ariaLabel="x" columns={columns} axisLabel="Turn" onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: /^Turn 0:/ }));
    fireEvent.keyDown(screen.getByRole("button", { name: /^Turn 1:/ }), { key: "Enter" });

    expect(onSelect.mock.calls).toEqual([["0"], ["1"]]);
  });

  it("marks the selected column", () => {
    render(<StackedColumns ariaLabel="x" columns={columns} axisLabel="Turn" selectedKey="1" />);
    expect(screen.getByRole("button", { name: /^Turn 1:/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows a tooltip with counts on hover and focus", () => {
    render(<StackedColumns ariaLabel="x" columns={columns} axisLabel="Turn" />);

    fireEvent.mouseEnter(screen.getByRole("button", { name: /^Turn 0:/ }));

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Turn 0");
    expect(tooltip).toHaveTextContent("Failed9");
  });

  it("offers a table view of the same data", () => {
    render(<StackedColumns ariaLabel="x" columns={columns} axisLabel="Turn" />);

    fireEvent.click(screen.getByRole("button", { name: "View as table" }));

    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByRole("columnheader", { name: "Failed" })).toBeInTheDocument();
  });

  it("captions the table with the chart's label and toggles with aria-pressed", () => {
    render(<StackedColumns ariaLabel="Tool outcomes per turn" columns={columns} axisLabel="Turn" />);
    const toggle = screen.getByRole("button", { name: "View as table" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-pressed", "true");
    const table = screen.getByRole("table", { name: "Tool outcomes per turn" });
    expect(within(table).getByRole("rowheader", { name: "0" })).toBeInTheDocument();
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent("19"); // 1 succeeded, 9 failed
  });

  it("renders an empty state with no columns", () => {
    render(<StackedColumns ariaLabel="x" columns={[]} axisLabel="Turn" emptyText="No turns." />);
    expect(screen.getByText("No turns.")).toBeInTheDocument();
  });
});
