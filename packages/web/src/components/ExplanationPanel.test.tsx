// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeTurn } from "../test-support/turn-fixture.js";
import { makeRun, makeTurnWithRuns } from "../test-support/subagent-fixture.js";
import { ExplanationPanel } from "./ExplanationPanel.js";

describe("ExplanationPanel", () => {
  it("says why a turn's tool calls are unknown, never 'no tools called'", () => {
    render(
      <ExplanationPanel
        turn={makeTurn({ toolCallsUnavailableReason: "No user message in the log matches this turn." })}
        mode="analyze"
      />,
    );

    expect(screen.getByText("No user message in the log matches this turn.")).toBeInTheDocument();
    expect(screen.queryByText(/No tools called this turn/)).not.toBeInTheDocument();
  });

  it("falls back to the session's event-log reason when the turn has none", () => {
    render(
      <ExplanationPanel
        turn={makeTurn()}
        mode="analyze"
        eventLogUnavailableReason="No Copilot CLI event log was found for this session."
      />,
    );

    expect(screen.getByText("No Copilot CLI event log was found for this session.")).toBeInTheDocument();
    expect(screen.queryByText(/No tools called this turn/)).not.toBeInTheDocument();
  });

  it("says no tools were called for a turn whose event log was read", () => {
    render(<ExplanationPanel turn={makeTurn({ toolCalls: [] })} mode="analyze" toolCallsAvailable />);

    expect(screen.getByText(/No tools called this turn/)).toBeInTheDocument();
  });

  it("renders the explanation for the given turn", () => {
    render(<ExplanationPanel turn={makeTurn({ explanation: "why this happened" })} mode="learn" />);

    expect(screen.getByText("why this happened")).toBeInTheDocument();
  });

  it("renders a placeholder when no turn is selected", () => {
    render(<ExplanationPanel turn={null} mode="learn" />);

    expect(screen.getByText(/no turn selected/i)).toBeInTheDocument();
  });

  it("renders the turn's trigger tag when set", () => {
    render(<ExplanationPanel turn={makeTurn({ triggeredEvent: "compaction" })} mode="learn" />);

    expect(screen.getByText("compaction")).toBeInTheDocument();
  });

  it("does not render a 'Tool calls this turn' section in learn mode", () => {
    render(<ExplanationPanel turn={makeTurn()} mode="learn" />);

    expect(screen.queryByText("Tool calls this turn")).not.toBeInTheDocument();
  });

  it("shows an unavailable message in analyze mode when the session has no tool-call artifacts", () => {
    render(
      <ExplanationPanel turn={makeTurn()} mode="analyze" toolCallsAvailable={false} />,
    );

    expect(screen.getByText("Tool calls this turn")).toBeInTheDocument();
    expect(
      screen.getByText("Tool-call detail unavailable for this session."),
    ).toBeInTheDocument();
  });

  it("shows a 'no tools called' message in analyze mode when this turn made no tool calls", () => {
    render(
      <ExplanationPanel
        turn={makeTurn({ toolCalls: [] })}
        mode="analyze"
        toolCallsAvailable={true}
      />,
    );

    expect(screen.getByText("No tools called this turn.")).toBeInTheDocument();
  });

  it("does not render an inspect-request/response button in learn mode", () => {
    render(
      <ExplanationPanel turn={makeTurn()} mode="learn" onOpenTurnInspector={() => {}} />,
    );

    expect(screen.queryByRole("button", { name: /inspect request\/response/i })).not.toBeInTheDocument();
  });

  it("renders an inspect-request/response button in analyze mode and calls onOpenTurnInspector when clicked", () => {
    const onOpenTurnInspector = vi.fn();

    render(
      <ExplanationPanel
        turn={makeTurn()}
        mode="analyze"
        toolCallsAvailable={true}
        onOpenTurnInspector={onOpenTurnInspector}
      />,
    );

    const button = screen.getByRole("button", { name: /inspect request\/response/i });
    fireEvent.click(button);

    expect(onOpenTurnInspector).toHaveBeenCalled();
  });

  it("lists each tool call's name and touched files in analyze mode", () => {
    const turn = makeTurn({
      toolCalls: [
        { name: "read_file", argsSummary: "src/a.ts", filesTouched: ["src/a.ts", "src/b.ts"] },
      ],
    });

    render(<ExplanationPanel turn={turn} mode="analyze" toolCallsAvailable={true} />);

    expect(screen.getByText("read_file")).toBeInTheDocument();
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(screen.getByText("src/b.ts")).toBeInTheDocument();
  });

  it("shows each tool call's outcome and shell command in analyze mode", () => {
    const turn = makeTurn({
      toolCalls: [
        {
          name: "Bash",
          argsSummary: "foo --version",
          shell: { command: "foo --version", program: "foo" },
          outcome: { status: "error", exitCode: 127, failureCategory: "command-not-found" },
        },
      ],
    });

    render(<ExplanationPanel turn={turn} mode="analyze" toolCallsAvailable={true} />);

    expect(screen.getByText("Failed · Command not found")).toBeInTheDocument();
    expect(screen.getByText("foo --version")).toBeInTheDocument();
  });

  it("shows a simulation's generated note and a Simulated tag", () => {
    render(
      <ExplanationPanel
        turn={makeTurn({
          simulation: {
            vendorId: "anthropic",
            modelId: "claude-sonnet-5.5",
            cacheOutcome: "hit",
            note: "On Claude Sonnet 5.5: cache hit, 4,500 tokens read from cache.",
            confidence: "inferred",
            sourceIds: [],
          },
        })}
        mode="learn"
      />,
    );

    expect(screen.getByText("Simulated")).toBeInTheDocument();
    expect(screen.getByText("Simulation note")).toHaveClass("sr-only");
    expect(screen.getByText(/cache hit, 4,500 tokens read from cache/)).toBeInTheDocument();
  });

  it("shows no simulation note or tag for a turn without a simulation", () => {
    render(<ExplanationPanel turn={makeTurn()} mode="learn" />);

    expect(screen.queryByText("Simulated")).not.toBeInTheDocument();
    expect(screen.queryByText("Simulation note")).not.toBeInTheDocument();
  });
});

describe("ExplanationPanel subagent runs", () => {
  const reason = "The subagent log runSubagent-Plan this turn started is missing.";
  const block = () => screen.getByRole("region", { name: "Subagent runs this turn" });

  it("has no block for a turn without runs", () => {
    render(<ExplanationPanel turn={makeTurn()} mode="analyze" />);
    expect(screen.queryByRole("region", { name: "Subagent runs this turn" })).not.toBeInTheDocument();
  });

  it("lists a row per run with the agent name, model, requests and AI Credits, then the totals", () => {
    const turn = makeTurnWithRuns([makeRun(), makeRun({ id: "call_2", agentName: "Plan", label: "runSubagent-Plan", roundsCount: 9, costAiCredits: { known: true, value: 11.95 } })]);
    render(<ExplanationPanel turn={turn} mode="analyze" />);

    const rows = within(block()).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Explore");
    expect(rows[0]).not.toHaveTextContent("runSubagent-Explore");
    expect(rows[0]).toHaveTextContent("claude-haiku-4.5");
    expect(rows[0]).toHaveTextContent("14 requests");
    expect(rows[0]).toHaveTextContent("30.11 AI Credits");
    expect(rows[1]).toHaveTextContent("9 requests");
    const totals = within(block()).getByRole("group", { name: "Turn totals" });
    expect(totals).toHaveTextContent("Main agent 4.25");
    expect(totals).toHaveTextContent("Subagent runs 42.06");
    expect(totals).toHaveTextContent("Turn 46.31");
  });

  it("falls back to the label when a run has no agent name", () => {
    const noAgent = makeRun();
    delete noAgent.agentName;
    render(<ExplanationPanel turn={makeTurnWithRuns([noAgent])} mode="analyze" />);
    expect(within(block()).getByRole("listitem")).toHaveTextContent("runSubagent-Explore");
  });

  it("shows a 0.00 run as 0.00 with 0 requests", () => {
    const turn = makeTurnWithRuns([makeRun({ roundsCount: 0, costAiCredits: { known: true, value: 0 } })], { own: 3.18 });
    render(<ExplanationPanel turn={turn} mode="analyze" />);
    expect(within(block()).getByRole("listitem")).toHaveTextContent("0 requests");
    expect(within(block()).getByRole("listitem")).toHaveTextContent("0.00 AI Credits");
  });

  it("says 'matched by time' on a run placed by time only", () => {
    const turn = makeTurnWithRuns([makeRun({ attribution: "timestamp" }), makeRun({ id: "call_2", label: "searchSubagent" })]);
    render(<ExplanationPanel turn={turn} mode="analyze" />);
    const [first, second] = within(block()).getAllByRole("listitem");
    expect(first).toHaveTextContent("matched by time");
    expect(second).not.toHaveTextContent("matched by time");
  });

  it("shows an unread run's reason, an em dash and never 'unknown' as a model", () => {
    const turn = makeTurnWithRuns([makeRun({ costAiCredits: { known: true, value: 7.2 } })], { unreadReason: reason });
    render(<ExplanationPanel turn={turn} mode="analyze" />);

    const rows = within(block()).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveTextContent(reason);
    expect(rows[1]).toHaveTextContent("—");
    expect(rows[1]).not.toHaveTextContent(/\bunknown\b.*claude|model unknown/i);
    const totals = within(block()).getByRole("group", { name: "Turn totals" });
    expect(totals).toHaveTextContent("Main agent 4.25");
    expect(totals).toHaveTextContent("Subagent runs unknown");
    expect(totals).toHaveTextContent("Turn unknown");
  });

  it("renders hostile agent, label and model text as text", () => {
    const hostile = "<img src=x onerror=alert(1)>";
    const turn = makeTurnWithRuns([makeRun({ agentName: hostile, model: "<script>alert(1)</script>" })]);
    const { container } = render(<ExplanationPanel turn={turn} mode="analyze" />);
    expect(within(block()).getByText(hostile)).toBeInTheDocument();
    expect(container.querySelector("img, script")).toBeNull();
  });

  it("sets the explanation at body size through a class, not an inline style", () => {
    render(<ExplanationPanel turn={makeTurn({ explanation: "why this happened" })} mode="learn" />);
    const text = screen.getByText("why this happened");
    expect(text).toHaveClass("explanation-text");
    expect(text.getAttribute("style")).toBeNull();
  });
});
