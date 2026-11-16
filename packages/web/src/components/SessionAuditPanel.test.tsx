// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { axeViolations } from "../test-support/axe.js";
import { HOSTILE_LABEL, makeSessionAudit, makeSubagentAudit } from "../test-support/audit-fixture.js";
import { SessionAuditPanel } from "./SessionAuditPanel.js";

function renderPanel(overrides: Partial<Parameters<typeof SessionAuditPanel>[0]> = {}) {
  const props = {
    sessionId: "s1",
    selectedTurnIndex: 0,
    onSelectTurn: vi.fn(),
    onInspectTurn: vi.fn(),
    loadAudit: vi.fn().mockResolvedValue(makeSessionAudit()),
    ...overrides,
  };
  render(<SessionAuditPanel {...props} />);
  return props;
}

describe("SessionAuditPanel", () => {
  it("loads the audit for the session and shows headline stat tiles", async () => {
    const props = renderPanel();

    expect(await screen.findByRole("group", { name: "Tool calls" })).toHaveTextContent("4");
    expect(props.loadAudit).toHaveBeenCalledWith("s1");
    expect(screen.getByRole("group", { name: "Failure rate" })).toHaveTextContent("75%");
    expect(screen.getByRole("group", { name: "Failure rate" })).toHaveTextContent("3 of 4 with a known outcome");
    expect(screen.getByRole("group", { name: "Retried commands" })).toHaveTextContent("1");
    // Output tokens lead; input (dominated by cache reads) is the note.
    const tokens = screen.getByRole("group", { name: "Output tokens in affected turns" });
    expect(tokens).toHaveTextContent("900");
    expect(tokens).toHaveTextContent("+42K input incl. cache");
  });

  it("shows a loading state, then an error if the audit fails to load", async () => {
    renderPanel({ loadAudit: vi.fn().mockRejectedValue(new Error("boom")) });
    expect(screen.getByText("Loading tool-call audit…")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
  });

  // §3.5 States (AsyncView).
  it("retries a failed load", async () => {
    const loadAudit = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(makeSessionAudit());
    renderPanel({ loadAudit });

    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("group", { name: "Tool calls" })).toHaveTextContent("4");
    expect(loadAudit).toHaveBeenCalledTimes(2);
  });

  it("explains a session with no tool calls and offers the cross-session audit", async () => {
    const onShowAllSessions = vi.fn();
    renderPanel({
      onShowAllSessions,
      loadAudit: vi.fn().mockResolvedValue(
        makeSessionAudit({
          totals: { toolCalls: 0, succeeded: 0, failed: 0, interrupted: 0, denied: 0, unknown: 0 },
          calls: [],
        }),
      ),
    });

    expect(await screen.findByRole("heading", { name: "No tool calls in this session" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View all sessions" }));
    expect(onShowAllSessions).toHaveBeenCalledTimes(1);
  });

  it("says tool calls aren't available, with the reason, never 'no tool calls'", async () => {
    renderPanel({
      loadAudit: vi.fn().mockResolvedValue(
        makeSessionAudit({
          totals: { toolCalls: 0, succeeded: 0, failed: 0, interrupted: 0, denied: 0, unknown: 0 },
          calls: [],
          toolCallsUnavailableReason: "No Copilot CLI event log was found for this session.",
        }),
      ),
    });

    expect(await screen.findByRole("heading", { name: "Tool calls not available" })).toBeInTheDocument();
    expect(screen.getByText(/No Copilot CLI event log was found/)).toBeInTheDocument();
    expect(screen.getByText(/doesn't mean the agent ran no tools/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "No tool calls in this session" })).not.toBeInTheDocument();
  });

  it("shows incomplete outcome coverage as a partial-data warning", async () => {
    renderPanel({
      loadAudit: vi.fn().mockResolvedValue(
        makeSessionAudit({
          outcomeCoverage: { known: 3, unknown: 1, unknownReasons: ["No result recorded."] },
        }),
      ),
    });

    expect(await screen.findByRole("note")).toHaveTextContent(/Partial data.*Outcome unknown for 1 of 4 tool calls/);
  });

  it("warns when outcome coverage is incomplete instead of implying zero failures", async () => {
    renderPanel({
      loadAudit: vi.fn().mockResolvedValue(
        makeSessionAudit({
          totals: { toolCalls: 3, succeeded: 0, failed: 0, interrupted: 0, denied: 0, unknown: 3 },
          failureRate: null,
          outcomeCoverage: { known: 0, unknown: 3, unknownReasons: ["This provider does not record tool-call outcomes."] },
        }),
      ),
    });

    expect(await screen.findByText(/Outcome unknown for 3 of 3 tool calls/)).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Failure rate" })).toHaveTextContent("—");
  });

  it("selects a turn from the per-turn outcome chart", async () => {
    const props = renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: /^Turn 1:/ }));

    expect(props.onSelectTurn).toHaveBeenCalledWith(1);
  });

  it("lists failures by default with command, category, exit code and evidence", async () => {
    renderPanel();

    const table = await screen.findByRole("table", { name: "Tool calls" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("definitely-not-installed-tool --version");
    expect(rows[0]).toHaveTextContent("Command not found");
    expect(rows[0]).toHaveTextContent("127");
    expect(rows[0]).toHaveTextContent("command not found");
  });

  it("filters the table by clicking a failure-category bar, and clears the filter", async () => {
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Timeout 1: 1 Failed" }));

    const table = screen.getByRole("table", { name: "Tool calls" });
    expect(within(table).getAllByRole("row").slice(1)).toHaveLength(1);
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent("sleep 8");

    fireEvent.click(screen.getByRole("button", { name: "Clear category filter: Timeout" }));
    expect(within(table).getAllByRole("row").slice(1)).toHaveLength(3);
  });

  it("filters by shell program from the program chart", async () => {
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "sleep 1: 0 Succeeded, 1 Failed" }));

    const table = screen.getByRole("table", { name: "Tool calls" });
    expect(within(table).getAllByRole("row").slice(1)).toHaveLength(1);
  });

  it("toggles status chips to include successful calls", async () => {
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: /^Succeeded/, pressed: false }));

    const table = screen.getByRole("table", { name: "Tool calls" });
    expect(within(table).getAllByRole("row").slice(1)).toHaveLength(4);
  });

  it("opens the turn inspector from a row", async () => {
    const props = renderPanel();

    const table = await screen.findByRole("table", { name: "Tool calls" });
    fireEvent.click(within(within(table).getAllByRole("row")[2]).getByRole("button", { name: "Inspect turn 1" }));

    expect(props.onInspectTurn).toHaveBeenCalledWith(1);
  });

  it("lists retried commands", async () => {
    renderPanel();

    const retries = await screen.findByRole("list", { name: "Retried commands" });
    expect(retries).toHaveTextContent("definitely-not-installed-tool --version");
    expect(retries).toHaveTextContent("2 attempts");
    expect(retries).toHaveTextContent("never succeeded");
  });

  it("reloads when the session changes", async () => {
    const loadAudit = vi.fn().mockResolvedValue(makeSessionAudit());
    const { rerender } = render(
      <SessionAuditPanel sessionId="s1" selectedTurnIndex={0} onSelectTurn={vi.fn()} onInspectTurn={vi.fn()} loadAudit={loadAudit} />,
    );
    rerender(
      <SessionAuditPanel sessionId="s2" selectedTurnIndex={0} onSelectTurn={vi.fn()} onInspectTurn={vi.fn()} loadAudit={loadAudit} />,
    );
    await waitFor(() => expect(loadAudit).toHaveBeenCalledWith("s2"));
  });

  describe("subagent runs (step 10.20)", () => {
    const renderSubagents = () => renderPanel({ loadAudit: vi.fn().mockResolvedValue(makeSubagentAudit()) });
    const callRows = () => within(screen.getByRole("table", { name: "Tool calls" })).getAllByRole("row").slice(1);

    it("says how many calls came from subagent runs, naming the unread ones", async () => {
      renderSubagents();
      expect(await screen.findByRole("group", { name: "Tool calls" })).toHaveTextContent("incl. 3 calls from 2 of 3 subagent runs");
    });

    it("leaves the sub-line out when no run exists", async () => {
      renderPanel();
      expect(await screen.findByRole("group", { name: "Tool calls" })).not.toHaveTextContent("subagent");
      expect(screen.queryByRole("group", { name: "Agent" })).not.toBeInTheDocument();
      expect(screen.queryByRole("table", { name: "Subagent runs" })).not.toBeInTheDocument();
    });

    it("filters the calls table by agent: All, Main agent, Subagents", async () => {
      renderSubagents();
      const group = await screen.findByRole("group", { name: "Agent" });
      fireEvent.click(screen.getByRole("button", { name: /^Succeeded/, pressed: false }));
      fireEvent.click(screen.getByRole("button", { name: /^Canceled/, pressed: false }));
      expect(within(group).getByRole("button", { name: /^All/ })).toHaveAttribute("aria-pressed", "true");
      expect(callRows()).toHaveLength(7);

      fireEvent.click(within(group).getByRole("button", { name: /^Main agent/ }));
      expect(callRows()).toHaveLength(4);
      fireEvent.click(within(group).getByRole("button", { name: /^Subagents/ }));
      expect(callRows()).toHaveLength(3);
    });

    it("shows Main or the run label with its depth in the Agent column", async () => {
      renderSubagents();
      await screen.findByRole("table", { name: "Tool calls" });
      const rows = callRows();
      expect(rows[0]).toHaveTextContent("Main");
      const nested = rows.find((row) => row.textContent?.includes("cat missing.txt"));
      expect(nested).toHaveTextContent("searchSubagent");
      expect(nested).toHaveTextContent("depth 2");
    });

    it("lists runs: known totals, an unread run with its reason and never 0, and a flagged run with totals plus a flag", async () => {
      renderSubagents();
      const table = await screen.findByRole("table", { name: "Subagent runs" });
      const [known, flagged, flagLine, unread] = within(table).getAllByRole("row").slice(1);
      expect(known).toHaveTextContent("2");
      expect(flagged).toHaveTextContent("depth 2");
      expect(flagged).toHaveTextContent("100%");
      expect(flagLine).toHaveTextContent("The run's start call is missing from the log.");
      expect(unread).toHaveTextContent("Review");
      expect(unread).toHaveTextContent("The subagent log is missing.");
      expect(unread).toHaveTextContent("—");
      // Agent, turn, and one merged cell: no calls, failed or rate figure that could read 0.
      expect(within(unread).getAllByRole("cell")).toHaveLength(3);
    });

    it("counts canceled calls apart from failures (D14)", async () => {
      renderSubagents();
      const tile = await screen.findByRole("group", { name: "Canceled" });
      expect(tile).toHaveTextContent("1");
      expect(tile).toHaveTextContent("not failures");
    });

    it("renders a hostile run label as text, never markup", async () => {
      renderSubagents();
      const table = await screen.findByRole("table", { name: "Subagent runs" });
      expect(within(table).getAllByText(HOSTILE_LABEL).length).toBeGreaterThan(0);
      expect(document.querySelector("img")).toBeNull();
    });

    it("is operable by keyboard and has no axe violations", async () => {
      const user = userEvent.setup();
      renderSubagents();
      const group = await screen.findByRole("group", { name: "Agent" });
      const main = within(group).getByRole("button", { name: /^Main agent/ });
      main.focus();
      await user.keyboard("{Enter}");
      expect(main).toHaveAttribute("aria-pressed", "true");
      await user.tab();
      expect(within(group).getByRole("button", { name: /^Subagents/ })).toHaveFocus();
      await user.keyboard(" ");
      expect(within(group).getByRole("button", { name: /^Subagents/ })).toHaveAttribute("aria-pressed", "true");
      expect(await axeViolations(document.body)).toEqual([]);
    });
  });
});
