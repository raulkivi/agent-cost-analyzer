import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeTurn } from "../test-support/turn-fixture.js";
import { TurnMetrics } from "./TurnMetrics.js";

// The narrow layout's details drawer: the metrics its priority columns hide
// (mock-up board 4), formatted as in the table.
describe("TurnMetrics", () => {
  const turns = [
    makeTurn({ index: 1 }),
    makeTurn({
      index: 2,
      usage: { ...makeTurn().usage, reasoning: { known: false, reason: "not reported" }, output: { known: true, value: 1400 } },
    }),
  ];

  it("lists each given column as a term and its value", () => {
    render(<TurnMetrics turns={turns} turnIndex={1} columns={["uncachedInput", "output", "reasoning", "model"]} />);

    const terms = screen.getAllByRole("term").map((term) => term.textContent);
    expect(terms).toEqual(["Uncached in", "Output", "Reasoning", "Model"]);
    const values = screen.getAllByRole("definition").map((value) => value.textContent);
    expect(values).toEqual(["100", (1400).toLocaleString(), "—", "example-model"]);
  });

  it("shows the running total for Cumulative, as the table does", () => {
    render(<TurnMetrics turns={turns} turnIndex={1} columns={["cumulative"]} />);

    expect(within(screen.getByRole("definition")).getByText("0.02")).toBeInTheDocument();
  });
});
