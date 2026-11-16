// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeTurn } from "../test-support/turn-fixture.js";
import { axeViolations } from "../test-support/axe.js";
import { makeClaudeRun, makeClaudeTurn, makeMissingRun, NO_CREDITS, priced, unpriced } from "../test-support/claude-subagent-fixture.js";
import { ExplanationPanel } from "./ExplanationPanel.js";
import { SessionKpiTiles } from "./SessionKpiTiles.js";
import { TurnInspector } from "./TurnInspector.js";
import { TurnMetrics } from "./TurnMetrics.js";
import { TurnsTable } from "./TurnsTable.js";

// Step CS13 (CS2 boards): Claude Code turns show tokens and a priced cost
// for their subagent runs, never an AI Credits figure, never 0 for unknown.

const generalPurpose = () => makeClaudeRun({ id: "agent-a3", label: "Agent-general-purpose", model: "claude-sonnet-5.5", roundsCount: 6, total: 730_000, cost: priced(0.29) });
const knownTurn = () => makeClaudeTurn([makeClaudeRun(), generalPurpose()]);
const unknownTurn = () => makeClaudeTurn([makeClaudeRun({ total: 220_000, cost: priced(0.02) }), makeMissingRun()], { ownTotal: 310_000, ownCost: priced(0.19), index: 7 });
const missing = "The subagent transcript this turn started is missing.";

describe("TurnsTable marker for a turn without AI Credits", () => {
  const renderTable = (turns = [makeClaudeTurn([], { index: 1 }), knownTurn()]) => render(<TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={vi.fn()} />);

  it("puts the fork marker in the Turn cell with tokens before cost in its name and tooltip", () => {
    renderTable();
    const marker = screen.getByRole("img", { name: "incl. 2.04M tokens, $0.38 priced, from 2 subagent runs" });
    expect(marker).toHaveAttribute("title", "incl. 2.04M tokens, $0.38 priced, from 2 subagent runs");
    expect(marker.closest("td")).toHaveTextContent(/^3/);
    expect(screen.getAllByRole("img", { name: /subagent/ })).toHaveLength(1);
  });

  it("keeps the AI Credits cell an em dash with the reason, never 0 and never a marker", () => {
    renderTable();
    const row = screen.getAllByRole("row")[2]!;
    const credits = within(row).getByTitle(NO_CREDITS.reason);
    expect(credits).toHaveTextContent(/^—$/);
    expect(within(credits).queryByRole("img")).toBeNull();
  });

  it("names an unknown run with a dashed marker and the reason", () => {
    renderTable([unknownTurn()]);
    const marker = screen.getByRole("img", { name: `Tokens and cost unknown: ${missing.charAt(0).toLowerCase()}${missing.slice(1, -1)}.` });
    expect(marker).toHaveClass("subagent-marker--unknown");
  });

  it("keeps the table one Tab stop: the marker is not focusable and arrows still move", async () => {
    const onSelect = vi.fn();
    render(<TurnsTable turns={[knownTurn(), makeClaudeTurn([makeClaudeRun()], { index: 4 })]} selectedTurnIndex={0} onSelectTurn={onSelect} />);
    for (const img of screen.getAllByRole("img", { name: /subagent/ })) expect(img).not.toHaveAttribute("tabindex");
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getAllByRole("row")[1]).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(onSelect).toHaveBeenLastCalledWith(1);
  });

  it("marks no turn that ran no runs", () => {
    renderTable([makeClaudeTurn([], { index: 1 }), makeTurn({ index: 2 })]);
    expect(screen.queryByRole("img", { name: /subagent/ })).toBeNull();
  });

  it("renders a hostile agent name only as text (the marker carries no run text)", () => {
    const { container } = renderTable([makeClaudeTurn([makeClaudeRun({ label: "Agent-<img src=x onerror=alert(1)>" })])]);
    expect(container.querySelector("img")).toBeNull();
  });

  it("passes axe", async () => {
    renderTable([knownTurn(), unknownTurn()]);
    expect(await axeViolations()).toEqual([]);
  });
});

describe("TurnMetrics drawer line", () => {
  it("shows the tooltip text as a visible line", () => {
    render(<TurnMetrics turns={[knownTurn()]} turnIndex={0} columns={["output"]} />);
    expect(screen.getByText("incl. 2.04M tokens, $0.38 priced, from 2 subagent runs")).toBeVisible();
  });
});

describe("ExplanationPanel subagent runs for a turn without AI Credits", () => {
  const block = () => screen.getByRole("region", { name: "Subagent runs this turn" });
  const show = (turn = knownTurn()) => render(<ExplanationPanel turn={turn} mode="analyze" />);

  it("lists a row per run with model, requests, tokens and priced cost", () => {
    show();
    const rows = within(block()).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Explore");
    expect(rows[0]).not.toHaveTextContent("Agent-Explore");
    expect(rows[0]).toHaveTextContent("claude-haiku-4.5");
    expect(rows[0]).toHaveTextContent("9 requests");
    expect(rows[0]).toHaveTextContent("1.31M tokens");
    expect(rows[0]).toHaveTextContent("$0.09");
    expect(rows[1]).toHaveTextContent("0.73M tokens");
  });

  it("gives the totals, the share, a Priced chip and the price note, and never an AI Credits figure", () => {
    show();
    const totals = within(block()).getByRole("group", { name: "Turn totals" });
    expect(totals).toHaveTextContent("Main agent 0.50M · $0.21");
    expect(totals).toHaveTextContent("Subagent runs 2.04M · $0.38");
    expect(totals).toHaveTextContent("Turn 2.54M · $0.59");
    expect(block()).toHaveTextContent("Subagent runs are 80% of this turn's tokens and 64% of its priced cost.");
    expect(block()).toHaveTextContent("Priced at Anthropic prices as of 2026-10-01, each run on its own model. Claude Code has no AI Credits.");
    expect(within(block()).getByText("Priced")).toBeInTheDocument();
    expect(block().textContent).not.toMatch(/\d AI Credits/);
  });

  it("says 'matched by time' and names the parent of a nested run", () => {
    const parent = makeClaudeRun({ id: "agent-p", label: "Agent-general-purpose", attribution: "timestamp" });
    const child = makeClaudeRun({ id: "agent-c", parentRunId: "agent-p", total: 110_000, cost: priced(0.01) });
    show(makeClaudeTurn([parent, child]));
    const rows = within(block()).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("matched by time");
    expect(rows[1]).toHaveTextContent("Started by general-purpose.");
  });

  it("shows an unread run as dashes with its reason and leaves the totals unknown", () => {
    show(unknownTurn());
    const rows = within(block()).getAllByRole("listitem");
    expect(rows[1]).toHaveTextContent("Plan");
    expect(rows[1]).toHaveTextContent("model unknown");
    expect(rows[1]).toHaveTextContent(missing);
    expect(rows[1]).toHaveClass("subagent-run--unknown");
    const totals = within(block()).getByRole("group", { name: "Turn totals" });
    expect(totals).toHaveTextContent("Main agent 0.31M · $0.19");
    expect(totals).toHaveTextContent("Subagent runs unknown");
    expect(totals).toHaveTextContent("Turn unknown");
    expect(block()).toHaveTextContent("This turn's tokens and cost are unknown until the Plan run can be read.");
  });

  it("keeps known tokens when only a run's cost is unknown", () => {
    const run = makeClaudeRun({ total: 90_000, cost: unpriced("a round of this run has no cache-write count") });
    show(makeClaudeTurn([run], { ownTotal: 88_000, ownCost: priced(0.04), index: 8 }));
    const totals = within(block()).getByRole("group", { name: "Turn totals" });
    expect(totals).toHaveTextContent("Subagent runs 90k · cost unknown");
    expect(block()).toHaveTextContent("This turn's cost is unknown until the Explore run can be read.");
  });

  it("renders hostile agent names and reasons only as text", () => {
    const hostile = "<img src=x onerror=alert(1)>";
    const run = makeClaudeRun({ label: `Agent-${hostile}`, cost: unpriced(hostile) });
    const { container } = show(makeClaudeTurn([run]));
    expect(container.querySelector("img[src]")).toBeNull();
    expect(block()).toHaveTextContent(hostile);
  });

  it("passes axe in every state", async () => {
    const { unmount } = show();
    expect(await axeViolations()).toEqual([]);
    unmount();
    show(unknownTurn());
    expect(await axeViolations()).toEqual([]);
  });
});

describe("TurnInspector note for a turn without AI Credits", () => {
  it("says the runs' tokens and cost are in the total, without AI Credits", () => {
    render(<TurnInspector sessionId="s" turnIndex={3} turn={knownTurn()} usageDataAvailable={false} onClose={vi.fn()} />);
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("2 subagent runs are not shown here.");
    expect(note).toHaveTextContent("Their tokens and priced cost are in this turn's total. The rounds below are the main agent's.");
    expect(note.textContent).not.toMatch(/AI Credits/);
  });

  it("says an unread run leaves the turn's tokens and cost unknown", () => {
    render(<TurnInspector sessionId="s" turnIndex={7} turn={unknownTurn()} usageDataAvailable={false} onClose={vi.fn()} />);
    expect(screen.getByRole("note")).toHaveTextContent("A run could not be read, so this turn's tokens and cost are unknown.");
  });
});

describe("SessionKpiTiles for a session without AI Credits", () => {
  const spend = (overrides = {}) => ({
    runs: 14,
    costAiCredits: NO_CREDITS,
    tokens: { uncachedInput: { known: true as const, value: 1_000_000 }, cacheWrite: { known: true as const, value: 400_000 }, cacheRead: { known: true as const, value: 30_000_000 }, output: { known: true as const, value: 100_000 } },
    cost: { billed: unpriced("none"), reported: unpriced("none"), priced: priced(9.2) },
    ...overrides,
  });
  const tile = (name: string) => screen.getByRole("group", { name });

  it("reads AI Credits n/a and adds a Priced cost tile carrying the sub-line", () => {
    render(<SessionKpiTiles turns={[knownTurn()]} subagentSpend={spend()} />);
    expect(tile("AI Credits")).toHaveTextContent("n/a");
    expect(tile("AI Credits")).toHaveTextContent("Claude Code has no AI Credits");
    expect(tile("Priced cost")).toHaveTextContent("$0.59");
    expect(tile("Priced cost")).toHaveTextContent("incl. $9.20 and 31.5M tokens from 14 subagent runs");
  });

  it("reads unknown with the reason, never a smaller total", () => {
    const gone = { known: false as const, reason: missing };
    render(<SessionKpiTiles turns={[unknownTurn()]} subagentSpend={spend({ tokens: { uncachedInput: gone, cacheWrite: gone, cacheRead: gone, output: gone } })} />);
    expect(tile("Priced cost")).toHaveTextContent("unknown");
    expect(tile("Priced cost")).toHaveTextContent(`unknown: ${missing}`);
  });

  it("shows the Priced cost tile for a session with no runs and leaves other providers alone", () => {
    const { unmount } = render(<SessionKpiTiles turns={[makeClaudeTurn([], { index: 0 })]} />);
    expect(tile("Priced cost")).toHaveTextContent("$0.21");
    unmount();
    render(<SessionKpiTiles turns={[makeTurn()]} />);
    expect(screen.queryByRole("group", { name: "Priced cost" })).toBeNull();
    expect(tile("AI Credits")).not.toHaveTextContent("n/a");
  });

  it("passes axe", async () => {
    render(
      <main>
        <SessionKpiTiles turns={[knownTurn()]} subagentSpend={spend()} />
      </main>,
    );
    expect(await axeViolations()).toEqual([]);
  });
});
