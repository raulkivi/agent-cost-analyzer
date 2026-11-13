// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { makeTurn } from "../test-support/turn-fixture.js";
import { makeRun, makeTurnWithRuns } from "../test-support/subagent-fixture.js";
import { runDisplayName, sessionSubagentLine, subagentInspectorNote, subagentSummary } from "./subagent-runs.js";

const reason = "The subagent log runSubagent-Plan this turn started is missing.";

describe("subagentSummary", () => {
  it("is undefined for a turn without subagent runs", () => {
    expect(subagentSummary(makeTurn())).toBeUndefined();
  });

  it("names the runs' share and count", () => {
    const turn = makeTurnWithRuns([makeRun(), makeRun({ id: "call_2", costAiCredits: { known: true, value: 11.95 } })]);
    expect(subagentSummary(turn)).toMatchObject({ unknown: false, text: "incl. 42.06 AI Credits from 2 subagent runs" });
  });

  it("uses the singular and shows a 0.00 run", () => {
    const turn = makeTurnWithRuns([makeRun({ costAiCredits: { known: true, value: 0 }, roundsCount: 0 })]);
    expect(subagentSummary(turn)?.text).toBe("incl. 0.00 AI Credits from 1 subagent run");
  });

  it("adds 'matched by time' when any run was placed by time", () => {
    const turn = makeTurnWithRuns([makeRun({ attribution: "timestamp", costAiCredits: { known: true, value: 9.85 } })]);
    expect(subagentSummary(turn)?.text).toBe("incl. 9.85 AI Credits from 1 subagent run, matched by time");
  });

  it("says unknown with the reason, never a figure", () => {
    const turn = makeTurnWithRuns([makeRun()], { unreadReason: reason });
    expect(subagentSummary(turn)).toMatchObject({ unknown: true, text: `AI Credits unknown: ${reason}` });
  });

  it("treats a turn with only an unread run as having runs", () => {
    const turn = makeTurnWithRuns([], { unreadReason: reason });
    expect(subagentSummary(turn)).toMatchObject({ unknown: true, unreadOnly: true });
  });
});

describe("runDisplayName", () => {
  it("prefers the agent name and falls back to the label", () => {
    expect(runDisplayName(makeRun())).toBe("Explore");
    const noAgent = makeRun();
    delete noAgent.agentName;
    expect(runDisplayName(noAgent)).toBe("runSubagent-Explore");
  });
});

describe("subagentInspectorNote", () => {
  it("is undefined without runs", () => {
    expect(subagentInspectorNote(makeTurn())).toBeUndefined();
  });

  it("states the runs left out and their credits, without 'matched by time'", () => {
    const turn = makeTurnWithRuns([makeRun({ attribution: "timestamp" }), makeRun({ id: "call_2", costAiCredits: { known: true, value: 11.95 } })]);
    expect(subagentInspectorNote(turn)).toEqual({
      heading: "2 subagent runs are not shown here.",
      body: "Their 42.06 AI Credits are in this turn's total. The rounds below are the main agent's.",
    });
  });

  it("says a 0.00 run recorded no model request", () => {
    const turn = makeTurnWithRuns([makeRun({ roundsCount: 0, costAiCredits: { known: true, value: 0 } })]);
    expect(subagentInspectorNote(turn)).toEqual({
      heading: "1 subagent run is not shown here.",
      body: "It recorded no model request (0.00 AI Credits). The rounds below are the main agent's.",
    });
  });

  it("says the turn is unknown when a run could not be read", () => {
    expect(subagentInspectorNote(makeTurnWithRuns([makeRun()], { unreadReason: reason }))?.body).toBe(
      "A run could not be read, so this turn's AI Credits are unknown. The rounds below are the main agent's.",
    );
  });
});

describe("sessionSubagentLine", () => {
  it("is undefined without spend", () => {
    expect(sessionSubagentLine(undefined)).toBeUndefined();
  });

  it("names the credits and runs, including 0.00", () => {
    expect(sessionSubagentLine({ runs: 3, costAiCredits: { known: true, value: 54.65 } })).toBe("incl. 54.65 from 3 subagent runs");
    expect(sessionSubagentLine({ runs: 1, costAiCredits: { known: true, value: 0 } })).toBe("incl. 0.00 from 1 subagent run");
  });

  it("gives the reason when unknown", () => {
    expect(sessionSubagentLine({ runs: 1, costAiCredits: { known: false, reason } })).toBe(`unknown: ${reason}`);
  });
});
