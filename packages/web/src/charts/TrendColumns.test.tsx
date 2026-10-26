import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TrendColumns } from "./TrendColumns.js";

const columns = [
  { key: "2026-10-09", label: "10-09", value: 5, note: "2 of 2 turns known" },
  { key: "2026-10-10", label: "10-10", value: 0.5 },
];

describe("TrendColumns", () => {
  it("renders one selectable column per point with its value", () => {
    const onSelect = vi.fn();
    render(<TrendColumns ariaLabel="AI Credits by day" columns={columns} format={(value) => value.toFixed(2)} onSelect={onSelect} />);

    const column = screen.getByRole("button", { name: "10-09: 5.00 (2 of 2 turns known)" });
    fireEvent.click(column);
    expect(onSelect).toHaveBeenCalledWith("2026-10-09", false);
    fireEvent.click(screen.getByRole("button", { name: "10-10: 0.50" }), { ctrlKey: true });
    expect(onSelect).toHaveBeenLastCalledWith("2026-10-10", true);
  });

  it("skips x-axis labels that would run into each other", () => {
    const days = Array.from({ length: 14 }, (_, index) => {
      const label = `10-${String(13 + index).padStart(2, "0")}`;
      return { key: `2026-${label}`, label, value: index };
    });
    const { container } = render(<TrendColumns ariaLabel="Trend" columns={days} format={String} />);

    const xLabels = [...container.querySelectorAll(".chart-column text.chart-axis-text")].map((text) => text.textContent);
    expect(xLabels).toEqual(["10-13", "10-15", "10-17", "10-19", "10-21", "10-23", "10-25"]);
  });

  it("marks selected columns", () => {
    render(<TrendColumns ariaLabel="Trend" columns={columns} format={String} selectedKeys={["2026-10-10"]} />);
    expect(screen.getByRole("button", { name: "10-10: 0.5" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /10-09/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("offers a table view with the same numbers", () => {
    render(<TrendColumns ariaLabel="Trend" columns={columns} format={(value) => value.toFixed(2)} />);
    fireEvent.click(screen.getByRole("button", { name: "View as table" }));
    expect(screen.getByRole("table")).toHaveTextContent("10-09");
    expect(screen.getByRole("table")).toHaveTextContent("5.00");
  });

  it("labels the table's columns and keeps the note, with the chart's rounding", () => {
    render(<TrendColumns ariaLabel="AI Credits by day" axisLabel="Day" valueLabel="AI Credits" columns={columns} format={(value) => value.toFixed(2)} />);
    fireEvent.click(screen.getByRole("button", { name: "View as table" }));

    const table = screen.getByRole("table", { name: "AI Credits by day" });
    expect(within(table).getByRole("columnheader", { name: "Day" })).toHaveAttribute("scope", "col");
    expect(within(table).getByRole("columnheader", { name: "AI Credits" })).toBeInTheDocument();
    expect(within(table).getByRole("rowheader", { name: "10-10" })).toBeInTheDocument();
    expect(within(table).getByText("0.50")).toBeInTheDocument();
    expect(within(table).getByText("2 of 2 turns known")).toBeInTheDocument();
  });

  it("shows the empty text without data", () => {
    render(<TrendColumns ariaLabel="Trend" columns={[]} format={String} emptyText="Nothing yet." />);
    expect(screen.getByText("Nothing yet.")).toBeInTheDocument();
  });
});
