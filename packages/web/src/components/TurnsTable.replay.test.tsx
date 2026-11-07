// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeReplay, NOT_REPLAYED_REASON } from "../test-support/replay-fixture.js";
import { makeTurn } from "../test-support/turn-fixture.js";
import { PRIORITY_TURN_COLUMNS } from "../lib/turn-columns.js";
import { TurnsTable } from "./TurnsTable.js";

const turns = [0, 1, 2].map((index) => makeTurn({ index }));

describe("TurnsTable with a replay (step 14.7, board 1)", () => {
  it("adds a Simulated · <model> group after the measured columns, measured columns unchanged", () => {
    render(<TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={() => {}} replay={makeReplay()} />);
    const [groups, columns] = screen.getAllByRole("row");
    const groupHeaders = within(groups!).getAllByRole("columnheader");
    expect(groupHeaders.map((cell) => cell.textContent)).toEqual(["Measured", "Simulated claude-sonnet-5.5"]);
    expect(groupHeaders[1]).toHaveAttribute("scope", "colgroup");
    expect(groupHeaders[1]).toHaveAttribute("colspan", "3");
    const names = within(columns!).getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(names.slice(0, 13)).toEqual(["Turn", "Trigger", "Rounds", "Calls", "Uncached in", "Cache read", "Cache write", "Tool", "Vision", "Reasoning", "Output", "AI Credits", "Cumulative"]);
    expect(names.slice(-4)).toEqual(["Model", "Cache", "Cache read", "Cost"]);
  });

  it("shows each replayed turn's outcome word, cache read and cost in dashed cells", () => {
    render(<TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={() => {}} replay={makeReplay()} />);
    const row = screen.getAllByRole("row")[2]!;
    const cells = within(row).getAllByRole("cell");
    const simulated = cells.slice(-3);
    expect(simulated.map((cell) => cell.textContent)).toEqual(["◐Partial", (29_000).toLocaleString(), "$0.31"]);
    simulated.forEach((cell) => expect(cell).toHaveClass("sim-cell"));
  });

  it("spans a turn not replayed across the simulated cells, with its reason; unknown is never 0", () => {
    render(<TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={() => {}} replay={makeReplay()} />);
    const row = screen.getAllByRole("row")[3]!;
    const gap = within(row).getByText("not replayed").closest("td")!;
    expect(gap).toHaveAttribute("colspan", "3");
    expect(gap).toHaveTextContent(NOT_REPLAYED_REASON);
    expect(gap).not.toHaveTextContent("0");
  });

  it("shows an unpriced simulated cost as unknown with its reason, and AI Credits with USD on hover", () => {
    const base = makeReplay();
    const replay = makeReplay({
      currency: "AI_CREDITS",
      pricing: { channel: "copilot", asOf: "2026-10-21", requested: "copilot" },
      turns: base.turns.map((turn, position) =>
        turn.simulated
          ? {
              ...turn,
              measured: { ...turn.measured, cost: { known: true as const, value: 1, currency: "AI_CREDITS" as const, basis: "billed" as const } },
              simulated: { ...turn.simulated, cost: position === 0 ? { known: true as const, value: 0.29, currency: "AI_CREDITS" as const } : { known: false as const, reason: "No price on 2026-09-14" } },
            }
          : turn,
      ),
    });
    render(<TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={() => {}} replay={replay} />);
    expect(screen.getByText("0.29")).toHaveAttribute("title", "≈ $0.0029");
    expect(screen.getByText("unknown")).toHaveAttribute("title", "Unknown: No price on 2026-09-14");
  });

  it("keeps the simulated cost at narrow widths, where the other simulated columns go to the drawer", () => {
    render(<TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={() => {}} replay={makeReplay()} columns={PRIORITY_TURN_COLUMNS} />);
    const [groups, columns] = screen.getAllByRole("row");
    expect(within(groups!).getAllByRole("columnheader")[1]).toHaveAttribute("colspan", "1");
    expect(within(columns!).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Turn", "Trigger", "AI Credits", "Cumulative", "Cost"]);
    expect(within(screen.getAllByRole("row")[3]!).getByText("not replayed").closest("td")).toHaveAttribute("colspan", "1");
  });

  it("has no simulated columns without a replay", () => {
    render(<TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={() => {}} />);
    expect(screen.getAllByRole("row")[0]!).not.toHaveTextContent("Simulated");
    expect(screen.queryByText("not replayed")).not.toBeInTheDocument();
  });

  it("stays navigable by keyboard", async () => {
    const onSelectTurn = vi.fn();
    render(<TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={onSelectTurn} replay={makeReplay()} />);
    await userEvent.tab();
    expect(screen.getAllByRole("row")[2]).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(onSelectTurn).toHaveBeenLastCalledWith(1);
  });
});
