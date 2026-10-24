import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ViewAsTable } from "./ViewAsTable.js";

const table = {
  caption: "Sample",
  rowHeader: "Row",
  columns: ["N"],
  rows: [{ key: "a", header: "a", cells: ["1"] }],
};

describe("ViewAsTable", () => {
  it("shows the chart first, behind an unpressed toggle", () => {
    render(
      <ViewAsTable table={table}>
        <p>the chart</p>
      </ViewAsTable>,
    );

    expect(screen.getByText("the chart")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View as table" })).toHaveAttribute("aria-pressed", "false");
  });

  it("swaps the chart for its table and back, keeping the toggle's name", () => {
    render(
      <ViewAsTable table={table}>
        <p>the chart</p>
      </ViewAsTable>,
    );

    fireEvent.click(screen.getByRole("button", { name: "View as table" }));
    expect(screen.getByRole("table", { name: "Sample" })).toBeInTheDocument();
    expect(screen.queryByText("the chart")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View as table" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "View as table" }));
    expect(screen.getByText("the chart")).toBeInTheDocument();
  });

  it("keeps the legend in the toolbar in both views", () => {
    render(
      <ViewAsTable table={table} legend={<span>legend</span>}>
        <p>the chart</p>
      </ViewAsTable>,
    );
    fireEvent.click(screen.getByRole("button", { name: "View as table" }));
    expect(screen.getByText("legend")).toBeInTheDocument();
  });
});
