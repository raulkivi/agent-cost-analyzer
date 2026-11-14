// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeTurn } from "../test-support/turn-fixture.js";
import { makeRun, makeTurnWithRuns } from "../test-support/subagent-fixture.js";
import { TurnsTable } from "./TurnsTable.js";

describe("TurnsTable", () => {
  it("renders the 14-column header spec in order", () => {
    render(<TurnsTable turns={[]} selectedTurnIndex={0} onSelectTurn={() => {}} />);

    const headers = screen.getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(headers).toEqual([
      "Turn",
      "Trigger",
      "Rounds",
      "Calls",
      "Uncached in",
      "Cache read",
      "Cache write",
      "Tool",
      "Vision",
      "Reasoning",
      "Output",
      "AI Credits",
      "Cumulative",
      "Model",
    ]);
  });

  it("renders one row per turn plus a header row", () => {
    const turns = [makeTurn({ index: 1 }), makeTurn({ index: 2 })];

    render(<TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={() => {}} />);

    expect(screen.getAllByRole("row")).toHaveLength(turns.length + 1);
  });

  it("shows an em dash for an unknown token count instead of a number or the word 'unavailable'", () => {
    const turns = [
      makeTurn({
        usage: { ...makeTurn().usage, cacheWrite: { known: false, reason: "no data" } },
      }),
    ];

    render(<TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={() => {}} />);

    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText(/unavailable/i)).not.toBeInTheDocument();
  });

  it("renders an Agent Host turn's known Cache write and Reasoning from its usage records, with an em dash for a turn without them", () => {
    const base = makeTurn().usage;
    const reconciled = makeTurn({
      index: 0,
      usage: { ...base, uncachedInput: { known: true, value: 600 }, cacheRead: { known: true, value: 1600 }, cacheWrite: { known: true, value: 300 }, reasoning: { known: true, value: 30 } },
    });
    const older = makeTurn({
      index: 1,
      usage: {
        ...base,
        cacheWrite: { known: false, reason: "no per-call usage records" },
        reasoning: { known: false, reason: "no per-call usage records" },
      },
    });

    render(<TurnsTable turns={[reconciled, older]} selectedTurnIndex={0} onSelectTurn={() => {}} />);

    const [first, second] = screen.getAllByRole("row").slice(1).map((row) => Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent));
    expect([first[6], first[9]]).toEqual(["300", "30"]);
    expect([second[6], second[9]]).toEqual(["—", "—"]);
  });

  it("renders a trigger tag when triggeredEvent is set, else a muted em dash", () => {
    const turns = [
      makeTurn({ index: 0, triggeredEvent: "compaction" }),
      makeTurn({ index: 1 }),
    ];

    render(<TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={() => {}} />);

    expect(screen.getByText("compaction")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("maps each triggeredEvent value to its display label", () => {
    const turns = [
      makeTurn({ index: 0, triggeredEvent: "model-switch" }),
      makeTurn({ index: 1, triggeredEvent: "tool-change" }),
      makeTurn({ index: 2, triggeredEvent: "clear" }),
      makeTurn({ index: 3, triggeredEvent: "rewind" }),
      makeTurn({ index: 4, triggeredEvent: "fork" }),
      makeTurn({ index: 5, triggeredEvent: "cache-expiry" }),
      makeTurn({ index: 6, triggeredEvent: "instructions-change" }),
      makeTurn({ index: 7, triggeredEvent: "image-change" }),
      makeTurn({ index: 8, triggeredEvent: "reasoning-toggle" }),
    ];

    render(<TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={() => {}} />);

    expect(screen.getByText("model switch")).toBeInTheDocument();
    expect(screen.getByText("tool change")).toBeInTheDocument();
    expect(screen.getByText("/clear")).toBeInTheDocument();
    expect(screen.getByText("/rewind")).toBeInTheDocument();
    expect(screen.getByText("fork")).toBeInTheDocument();
    expect(screen.getByText("cache expiry")).toBeInTheDocument();
    expect(screen.getByText("instructions change")).toBeInTheDocument();
    expect(screen.getByText("image change")).toBeInTheDocument();
    expect(screen.getByText("reasoning toggle")).toBeInTheDocument();
  });

  it("renders the turn's rounds count", () => {
    const turns = [makeTurn({ usage: { ...makeTurn().usage, roundsCount: 4 } })];

    render(<TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={() => {}} />);

    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("shows an em dash for rounds count when unknown", () => {
    const turns = [
      makeTurn({ usage: { ...makeTurn().usage, roundsCount: undefined } }),
    ];

    render(<TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={() => {}} />);

    const rows = screen.getAllByRole("row");
    const roundsCellOf = (row: HTMLElement) => row.querySelectorAll("td")[2].textContent;
    expect(roundsCellOf(rows[1])).toBe("—");
  });

  it("renders the turn's model, muted", () => {
    const turns = [makeTurn({ usage: { ...makeTurn().usage, model: "claude-sonnet-5" } })];

    render(<TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={() => {}} />);

    expect(screen.getByText("claude-sonnet-5")).toBeInTheDocument();
  });

  it("renders AI Credits without a dollar sign, rounded to 2 decimal places", () => {
    const turns = [
      makeTurn({
        usage: {
          ...makeTurn().usage,
          costAiCredits: { known: true, value: 2.79598 },
        },
      }),
    ];

    render(<TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={() => {}} />);

    // Single turn, so AI Credits and Cumulative both show "2.80".
    expect(screen.getAllByText("2.80")).toHaveLength(2);
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it("renders a running cumulative AI Credits total per row", () => {
    const turns = [
      makeTurn({
        index: 0,
        usage: { ...makeTurn().usage, costAiCredits: { known: true, value: 1.5 } },
      }),
      makeTurn({
        index: 1,
        usage: { ...makeTurn().usage, costAiCredits: { known: true, value: 2.25 } },
      }),
    ];

    render(<TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={() => {}} />);

    const rows = screen.getAllByRole("row");
    // Cumulative is the last cell before Model.
    const cumulativeCellOf = (row: HTMLElement) => {
      const cells = row.querySelectorAll("td");
      return cells[cells.length - 2].textContent;
    };
    expect(cumulativeCellOf(rows[1])).toBe("1.50");
    expect(cumulativeCellOf(rows[2])).toBe("3.75");
  });

  it("shows an em dash for cumulative AI Credits on and after a row whose own cost is unknown", () => {
    const turns = [
      makeTurn({
        index: 0,
        usage: { ...makeTurn().usage, costAiCredits: { known: true, value: 1.5 } },
      }),
      makeTurn({
        index: 1,
        usage: { ...makeTurn().usage, costAiCredits: { known: false, reason: "no data" } },
      }),
      makeTurn({
        index: 2,
        usage: { ...makeTurn().usage, costAiCredits: { known: true, value: 2.25 } },
      }),
    ];

    render(<TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={() => {}} />);

    const rows = screen.getAllByRole("row");
    const cumulativeCellOf = (row: HTMLElement) => {
      const cells = row.querySelectorAll("td");
      return cells[cells.length - 2].textContent;
    };
    expect(cumulativeCellOf(rows[1])).toBe("1.50");
    expect(cumulativeCellOf(rows[2])).toBe("—");
    expect(cumulativeCellOf(rows[3])).toBe("—");
  });

  it("calls onSelectTurn with the clicked row's array index", () => {
    const onSelectTurn = vi.fn();
    const turns = [makeTurn({ index: 1 }), makeTurn({ index: 2 })];

    render(<TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={onSelectTurn} />);
    const rows = screen.getAllByRole("row");
    fireEvent.click(rows[2]); // header row + turn 0's row + turn 1's row

    expect(onSelectTurn).toHaveBeenCalledWith(1);
  });

  it("calls onSelectTurn when a row is activated via Enter/Space keydown", () => {
    const onSelectTurn = vi.fn();
    const turns = [makeTurn({ index: 1 }), makeTurn({ index: 2 })];

    render(<TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={onSelectTurn} />);
    const rows = screen.getAllByRole("row");
    fireEvent.keyDown(rows[2], { key: "Enter" });

    expect(onSelectTurn).toHaveBeenCalledWith(1);
  });

  it("marks the selected row via aria-selected", () => {
    const turns = [makeTurn({ index: 1 }), makeTurn({ index: 2 })];

    render(<TurnsTable turns={turns} selectedTurnIndex={1} onSelectTurn={() => {}} />);
    const rows = screen.getAllByRole("row");

    expect(rows[1]).toHaveAttribute("aria-selected", "false");
    expect(rows[2]).toHaveAttribute("aria-selected", "true");
  });

  it("shows each turn's tool-call count with a failure badge when calls failed", () => {
    const turns = [
      makeTurn({
        index: 0,
        toolCalls: [
          { name: "Bash", argsSummary: "ls", outcome: { status: "success" } },
          { name: "Bash", argsSummary: "foo", outcome: { status: "error", failureCategory: "command-not-found" } },
          { name: "Bash", argsSummary: "sleep 9", outcome: { status: "interrupted", failureCategory: "timeout" } },
        ],
      }),
      makeTurn({ index: 1, toolCalls: [{ name: "Bash", argsSummary: "ls", outcome: { status: "success" } }] }),
    ];

    render(<TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={() => {}} />);

    expect(screen.getByLabelText("2 of 3 tool calls failed")).toHaveTextContent("✕2");
    expect(screen.queryByLabelText(/of 1 tool calls failed/)).not.toBeInTheDocument();
  });

  // axe (§3.5): aria-label is only allowed on an element with a role.
  it("gives the failure badge an image role, so its label is a permitted name", () => {
    const turns = [
      makeTurn({
        index: 0,
        toolCalls: [{ name: "Bash", argsSummary: "x", outcome: { status: "error", failureCategory: "command-not-found" } }],
      }),
    ];
    render(<TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={() => {}} />);

    expect(screen.getByRole("img", { name: "1 of 1 tool calls failed" })).toHaveClass("failure-badge");
  });

  // §3.5 Layout: the column chooser and the narrow layout's priority columns.
  it("renders only the given columns, header and cells alike", () => {
    const turns = [makeTurn({ index: 1 })];

    render(
      <TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={() => {}} columns={["turn", "aiCredits", "model"]} />,
    );

    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Turn", "AI Credits", "Model"]);
    expect(screen.getAllByRole("row")[1]!.querySelectorAll("td")).toHaveLength(3);
  });

  // §3.5 Accessibility: arrow keys move through the rows, Enter opens.
  describe("keyboard", () => {
    const turns = [makeTurn({ index: 1 }), makeTurn({ index: 2 }), makeTurn({ index: 3 })];

    function StatefulTable({ onOpenTurn }: { onOpenTurn?: (turnIndex: number) => void }) {
      const [selected, setSelected] = useState(0);
      return (
        <>
          <button type="button">before</button>
          <TurnsTable turns={turns} selectedTurnIndex={selected} onSelectTurn={setSelected} onOpenTurn={onOpenTurn} />
          <button type="button">after</button>
        </>
      );
    }

    const bodyRows = () => screen.getAllByRole("row").slice(1);

    it("is one Tab stop, entered at the selected row (roving tabindex)", async () => {
      const user = userEvent.setup();
      render(<StatefulTable />);

      await user.click(screen.getByRole("button", { name: "before" }));
      await user.tab();
      expect(bodyRows()[0]).toHaveFocus();
      await user.tab();
      expect(screen.getByRole("button", { name: "after" })).toHaveFocus();
    });

    it("moves focus and selection with ArrowDown/ArrowUp, Home and End", async () => {
      const user = userEvent.setup();
      render(<StatefulTable />);
      bodyRows()[0]!.focus();

      await user.keyboard("{ArrowDown}");
      expect(bodyRows()[1]).toHaveFocus();
      expect(bodyRows()[1]).toHaveAttribute("aria-selected", "true");

      await user.keyboard("{End}");
      expect(bodyRows()[2]).toHaveFocus();
      await user.keyboard("{ArrowDown}");
      expect(bodyRows()[2]).toHaveFocus();

      await user.keyboard("{ArrowUp}");
      expect(bodyRows()[1]).toHaveFocus();
      await user.keyboard("{Home}");
      expect(bodyRows()[0]).toHaveFocus();
      expect(bodyRows()[0]).toHaveAttribute("aria-selected", "true");
    });

    it("opens the focused turn with Enter", async () => {
      const user = userEvent.setup();
      const onOpenTurn = vi.fn();
      render(<StatefulTable onOpenTurn={onOpenTurn} />);
      bodyRows()[0]!.focus();

      await user.keyboard("{ArrowDown}{Enter}");

      expect(onOpenTurn).toHaveBeenCalledWith(1);
    });
  });

  describe("simulated turns (step 13.7)", () => {
    const simulation = {
      vendorId: "anthropic",
      modelId: "claude-sonnet-5.5",
      cacheOutcome: "partial" as const,
      note: "n",
      confidence: "inferred" as const,
      sourceIds: [],
    };
    const simulated = [
      makeTurn({
        index: 1,
        usage: { ...makeTurn().usage, costAiCredits: { known: true, value: 1.225 } },
        simulation,
      }),
    ];

    it("shows a Cache column with the outcome, after Trigger", () => {
      render(<TurnsTable turns={simulated} selectedTurnIndex={0} onSelectTurn={() => {}} />);

      const headers = screen.getAllByRole("columnheader").map((cell) => cell.textContent);
      expect(headers.slice(0, 3)).toEqual(["Turn", "Trigger", "Cache"]);
      expect(screen.getByText("Cache partial hit")).toBeInTheDocument();
    });

    it("hides the Cache column for turns without a simulation", () => {
      render(<TurnsTable turns={[makeTurn()]} selectedTurnIndex={0} onSelectTurn={() => {}} />);

      expect(screen.queryByRole("columnheader", { name: "Cache" })).not.toBeInTheDocument();
    });

    it("adds a USD tooltip to the AI Credits cells of simulated turns only", () => {
      const { container, rerender } = render(
        <TurnsTable turns={simulated} selectedTurnIndex={0} onSelectTurn={() => {}} columns={["turn", "aiCredits", "cumulative"]} />,
      );
      expect(container.querySelectorAll('td [title="≈ $0.0123"]')).toHaveLength(2);

      rerender(
        <TurnsTable turns={[makeTurn()]} selectedTurnIndex={0} onSelectTurn={() => {}} columns={["turn", "aiCredits", "cumulative"]} />,
      );
      expect(container.querySelector("[title]")).toBeNull();
    });
  });
});

describe("TurnsTable subagent marker", () => {
  const reason = "The subagent log runSubagent-Plan this turn started is missing.";
  const marker = (name: RegExp | string) => screen.getByRole("img", { name });

  it("marks a turn that ran subagent runs, naming the share in its tooltip and accessible name", () => {
    const turns = [makeTurn({ index: 1 }), makeTurnWithRuns([makeRun(), makeRun({ id: "call_2", costAiCredits: { known: true, value: 11.95 } })], { index: 2 })];
    render(<TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={() => {}} />);

    const cell = marker("incl. 42.06 AI Credits from 2 subagent runs");
    expect(cell).toHaveAttribute("title", "incl. 42.06 AI Credits from 2 subagent runs");
    expect(cell.closest("td")).toHaveTextContent("46.31");
    expect(screen.getAllByRole("img", { name: /subagent/ })).toHaveLength(1);
  });

  it("still marks a turn whose runs all cost 0.00", () => {
    const turn = makeTurnWithRuns([makeRun({ roundsCount: 0, costAiCredits: { known: true, value: 0 } })], { own: 3.18 });
    render(<TurnsTable turns={[turn]} selectedTurnIndex={0} onSelectTurn={() => {}} />);
    expect(marker("incl. 0.00 AI Credits from 1 subagent run")).toBeInTheDocument();
  });

  it("says 'matched by time' in the tooltip", () => {
    const turn = makeTurnWithRuns([makeRun({ attribution: "timestamp" })]);
    render(<TurnsTable turns={[turn]} selectedTurnIndex={0} onSelectTurn={() => {}} />);
    expect(marker("incl. 30.11 AI Credits from 1 subagent run, matched by time")).toBeInTheDocument();
  });

  it("shows an unknown turn as an em dash with a dashed marker and the reason, never a figure", () => {
    const turn = makeTurnWithRuns([makeRun()], { unreadReason: reason });
    render(<TurnsTable turns={[turn]} selectedTurnIndex={0} onSelectTurn={() => {}} />);

    const unknown = marker(`AI Credits unknown: ${reason}`);
    expect(unknown).toHaveClass("subagent-marker--unknown");
    expect(unknown.closest("td")).toHaveTextContent(/^—/);
  });

  it("keeps the table one Tab stop: the marker is not focusable and arrows still move between rows", async () => {
    const turns = [makeTurnWithRuns([makeRun()], { index: 1 }), makeTurnWithRuns([makeRun()], { index: 2 })];
    const onSelect = vi.fn();
    render(<TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={onSelect} />);

    for (const img of screen.getAllByRole("img", { name: /subagent/ })) expect(img).not.toHaveAttribute("tabindex");
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getAllByRole("row")[1]).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(onSelect).toHaveBeenLastCalledWith(1);
  });

  it("renders hostile agent text only as text (the marker carries no run text)", () => {
    const turn = makeTurnWithRuns([makeRun({ agentName: "<img src=x onerror=alert(1)>" })]);
    const { container } = render(<TurnsTable turns={[turn]} selectedTurnIndex={0} onSelectTurn={() => {}} />);
    expect(container.querySelector("img")).toBeNull();
  });

  it("marks the table for the tighter cell padding", () => {
    render(<TurnsTable turns={[]} selectedTurnIndex={0} onSelectTurn={() => {}} />);
    expect(screen.getByRole("table")).toHaveClass("turns-table");
  });
});
