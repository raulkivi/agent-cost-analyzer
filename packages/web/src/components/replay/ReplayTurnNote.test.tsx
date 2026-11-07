// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeReplay, NOT_REPLAYED_REASON } from "../../test-support/replay-fixture.js";
import { makeTurn } from "../../test-support/turn-fixture.js";
import { ReplayTurnNote } from "./ReplayTurnNote.js";

describe("ReplayTurnNote (step 14.7, board 1's right column)", () => {
  it("shows the simulated outcome and measured beside simulated cache read, write and cost", () => {
    render(<ReplayTurnNote turn={makeTurn({ index: 0 })} replay={makeReplay()} />);
    const note = screen.getByRole("region", { name: "Simulated on claude-sonnet-5.5" });
    expect(within(note).getByText("Simulated", { selector: ".sim-badge" })).toBeInTheDocument();
    expect(note).toHaveTextContent("Partial");
    const table = within(note).getByRole("table");
    const rows = within(table).getAllByRole("row").map((row) => row.textContent);
    expect(rows).toEqual([
      "MeasuredSimulated",
      `Cache read${(30_000).toLocaleString()}${(29_000).toLocaleString()}`,
      `Cache write${(200).toLocaleString()}${(1_200).toLocaleString()}`,
      "Cost, USD$0.52$0.31",
    ]);
  });

  it("says a turn wasn't replayed, with the reason, and shows no simulated figure", () => {
    render(<ReplayTurnNote turn={makeTurn({ index: 1 })} replay={makeReplay()} />);
    const note = screen.getByRole("region", { name: "Simulated on claude-sonnet-5.5" });
    expect(note).toHaveTextContent(`Not replayed: ${NOT_REPLAYED_REASON}`);
    expect(within(note).queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows an unknown measured figure as unknown, never 0", () => {
    const base = makeReplay();
    const replay = makeReplay({
      turns: base.turns.map((turn) => (turn.turnIndex === 0 ? { ...turn, measured: { cacheRead: null, cost: { known: false as const, reason: "no cost" } } } : turn)),
      totals: { ...base.totals, measured: { value: 0.28, knownTurns: 1, turns: 3 }, difference: -0.11 },
    });
    render(<ReplayTurnNote turn={makeTurn({ index: 0, usage: { ...makeTurn().usage, cacheWrite: { known: false, reason: "n/a" } } })} replay={replay} />);
    const rows = within(screen.getByRole("table")).getAllByRole("row").map((row) => row.textContent);
    expect(rows[1]).toBe(`Cache readunknown${(29_000).toLocaleString()}`);
    expect(rows[2]).toBe(`Cache writeunknown${(1_200).toLocaleString()}`);
    expect(rows[3]).toBe("Cost, USDunknown$0.31");
  });
});
