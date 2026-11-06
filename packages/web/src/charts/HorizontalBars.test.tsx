import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HorizontalBars } from "./HorizontalBars.js";

const series = [
  { id: "ok", label: "Succeeded", color: "#597ea3" },
  { id: "failed", label: "Failed", color: "#d03b3b" },
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
