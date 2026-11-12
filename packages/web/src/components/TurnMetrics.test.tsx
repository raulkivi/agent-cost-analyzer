// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeTurn } from "../test-support/turn-fixture.js";
import { makeRun, makeTurnWithRuns } from "../test-support/subagent-fixture.js";
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

// Step 14.7: the narrow drawer shows the simulated columns the table hides.
describe("TurnMetrics with a replay", () => {
  it("lists the hidden simulated figures, labelled Simulated, or not replayed with the reason", async () => {
    const { makeReplay, NOT_REPLAYED_REASON } = await import("../test-support/replay-fixture.js");
    const turns = [0, 1].map((index) => makeTurn({ index }));
    const { rerender } = render(<TurnMetrics turns={turns} turnIndex={0} columns={["replayCache", "replayCacheRead", "model"]} replay={makeReplay()} />);
    expect(screen.getByText("Simulated cache").nextElementSibling).toHaveTextContent("Partial");
    expect(screen.getByText("Simulated cache read").nextElementSibling).toHaveTextContent((29_000).toLocaleString());

    rerender(<TurnMetrics turns={turns} turnIndex={1} columns={["replayCache", "replayCacheRead"]} replay={makeReplay()} />);
    expect(screen.getAllByText("not replayed")[0]).toHaveAttribute("title", NOT_REPLAYED_REASON);
  });

  it("leaves the simulated figures out without a replay", () => {
    render(<TurnMetrics turns={[makeTurn({ index: 0 })]} turnIndex={0} columns={["replayCache", "model"]} />);
    expect(screen.queryByText("Simulated cache")).not.toBeInTheDocument();
  });
});

describe("TurnMetrics subagent line (narrow layouts have no hover)", () => {
  it("shows the tooltip text as a visible line under the metrics", () => {
    const turn = makeTurnWithRuns([makeRun({ attribution: "timestamp" })]);
    render(<TurnMetrics turns={[turn]} turnIndex={0} columns={["output"]} />);
    expect(screen.getByText("incl. 30.11 AI Credits from 1 subagent run, matched by time")).toBeVisible();
  });

  it("shows the reason for an unknown turn", () => {
    const turn = makeTurnWithRuns([], { unreadReason: "The subagent log is missing." });
    render(<TurnMetrics turns={[turn]} turnIndex={0} columns={[]} />);
    expect(screen.getByText("AI Credits unknown: The subagent log is missing.")).toBeVisible();
  });

  it("shows no line for a turn without runs", () => {
    render(<TurnMetrics turns={[makeTurn()]} turnIndex={0} columns={["output"]} />);
    expect(screen.queryByText(/subagent/)).not.toBeInTheDocument();
  });
});
