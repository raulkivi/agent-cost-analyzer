import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChartDataTable } from "./ChartDataTable.js";

describe("ChartDataTable", () => {
  it("renders a captioned table with scoped column and row headers", () => {
    render(
      <ChartDataTable
        caption="Tokens by model"
        rowHeader="Model"
        columns={["Input", "Output"]}
        rows={[{ key: "a", header: "sonnet", cells: ["10", "2"] }]}
      />,
    );

    const table = screen.getByRole("table", { name: "Tokens by model" });
    expect(table.querySelector("caption")).toHaveTextContent("Tokens by model");
    expect(within(table).getByRole("columnheader", { name: "Model" })).toHaveAttribute("scope", "col");
    expect(within(table).getByRole("columnheader", { name: "Output" })).toHaveAttribute("scope", "col");
    expect(within(table).getByRole("rowheader", { name: "sonnet" })).toHaveAttribute("scope", "row");
    expect(within(table).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["10", "2"]);
  });

  it("shows a null cell as unknown, never as zero", () => {
    render(<ChartDataTable caption="c" rowHeader="Turn" columns={["AI Credits"]} rows={[{ key: "1", header: "1", cells: [null] }]} />);

    expect(screen.getByRole("cell")).toHaveTextContent("unknown");
  });
});
