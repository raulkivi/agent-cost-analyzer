// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { toTurnDetailViewModel } from "./turn-detail.js";
import { subagentRun, turnView, turnViewWithRuns } from "./turn-view-fixture.js";

describe("toTurnDetailViewModel", () => {
  it("formats the header, event line, prompt excerpt and token rows", () => {
    const vm = toTurnDetailViewModel(turnView());
    expect(vm.heading).toBe("Turn 17 · claude-sonnet-5.5");
    expect(vm.eventText).toBe("Context was compacted before this turn.");
    expect(vm.prompt).toEqual({ text: "Rewrite the decoder to stream frames instead of buffering the whole payload.", truncated: false });
    expect(vm.tokens.map((row) => [row.label, row.value.text])).toEqual([
      ["Uncached input", "19,806"],
      ["Cache read", "268,090"],
      ["Cache write", "22,516"],
      ["Output", "3,108"],
    ]);
    expect(vm.tokens[3]!.value.estimate).toBe(true);
    expect(vm.aiCredits.text).toBe("4.10");
  });

  it("reads an unknown figure as Unknown, never 0", () => {
    const base = turnView();
    const vm = toTurnDetailViewModel(turnView({ usage: { ...base.usage, cacheRead: { known: false, reason: "x" }, costAiCredits: { known: false, reason: "x" } } }));
    expect(vm.tokens[1]!.value).toMatchObject({ text: "Unknown", known: false });
    expect(vm.aiCredits.text).toBe("Unknown");
  });

  it("summarises tool calls by name and flags failures", () => {
    const vm = toTurnDetailViewModel(turnView());
    expect(vm.toolCalls).toEqual({ count: "3", summary: "read_file ×2 · run_tests ×1", failed: 1 });
  });

  it("says Unknown with the reason when the text or tool calls are not recorded", () => {
    const vm = toTurnDetailViewModel(turnView({ userMessage: "", textUnavailableReason: "event log missing", toolCalls: [], toolCallsUnavailableReason: "event log missing" }));
    expect(vm.prompt).toEqual({ unavailable: "event log missing" });
    expect(vm.toolCalls).toEqual({ count: "Unknown", summary: "event log missing", failed: 0 });
  });

  it("omits the event line when the turn has no event", () => {
    expect(toTurnDetailViewModel(turnView({ triggeredEvent: undefined, explanation: "" })).eventText).toBeUndefined();
  });

  describe("subagent runs (step 10.19)", () => {
    it("has no subagent section when no run was read", () => {
      expect(toTurnDetailViewModel(turnView()).subagents).toBeUndefined();
    });

    it("lists runs by agent name with the note, the main agent's share and the subagents' share", () => {
      const vm = toTurnDetailViewModel(turnViewWithRuns([subagentRun(), subagentRun({ id: "call_b", label: "runSubagent-Plan", agentName: "Plan", roundsCount: 9, costAiCredits: { known: true, value: 11.95 } })]));
      const section = vm.subagents!;
      expect(section.heading).toBe("Subagent runs (2)");
      expect(section.note).toEqual({ text: "incl. 42.06 from 2 subagent runs", known: true });
      expect(section.mainAgent.text).toBe("4.25");
      expect(section.subagents.text).toBe("42.06");
      expect(section.runs.map((run) => [run.name, run.model, run.requests, run.aiCredits.text])).toEqual([
        ["Explore", "claude-haiku-4.5", "14 requests", "30.11"],
        ["Plan", "claude-haiku-4.5", "9 requests", "11.95"],
      ]);
    });

    it("names the run by its label only when there is no agent name", () => {
      const noName = { ...subagentRun(), agentName: undefined };
      expect(toTurnDetailViewModel(turnViewWithRuns([noName])).subagents!.runs[0]!.name).toBe("runSubagent-Explore");
    });

    it("shows the marker note at 0.00, singular for one run", () => {
      const vm = toTurnDetailViewModel(turnViewWithRuns([subagentRun({ label: "searchSubagent", agentName: undefined, roundsCount: 0, costAiCredits: { known: true, value: 0 } })]));
      expect(vm.subagents!.note.text).toBe("incl. 0.00 from 1 subagent run");
      expect(vm.subagents!.runs[0]).toMatchObject({ requests: "0 requests", aiCredits: { text: "0.00", known: true } });
      expect(vm.subagents!.subagents.text).toBe("0.00");
    });

    it("says matched by time on the note and the run", () => {
      const vm = toTurnDetailViewModel(turnViewWithRuns([subagentRun({ attribution: "timestamp" })]));
      expect(vm.subagents!.note.text).toBe("incl. 30.11 from 1 subagent run, matched by time");
      expect(vm.subagents!.runs[0]!.matchedByTime).toBe(true);
    });

    it("reads an unknown run as Unknown with its reason, never 0, and the turn note says unknown", () => {
      const vm = toTurnDetailViewModel(turnViewWithRuns([subagentRun(), subagentRun({ id: "call_b", label: "runSubagent-Plan", agentName: "Plan", model: "", costAiCredits: { known: false, reason: "The subagent log runSubagent-Plan is missing." } })]));
      const section = vm.subagents!;
      expect(section.note).toEqual({ text: "unknown: The subagent log runSubagent-Plan is missing.", known: false });
      expect(section.subagents).toMatchObject({ text: "Unknown", known: false });
      expect(section.mainAgent.text).toBe("4.25");
      expect(section.runs[1]).toMatchObject({ model: "model unknown", requests: "—", aiCredits: { text: "Unknown", known: false }, reason: "The subagent log runSubagent-Plan is missing." });
      expect(vm.aiCredits.known).toBe(false);
    });
  });
});
