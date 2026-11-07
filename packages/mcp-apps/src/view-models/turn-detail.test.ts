import { describe, expect, it } from "vitest";
import { toTurnDetailViewModel } from "./turn-detail.js";
import { turnView } from "./turn-view-fixture.js";

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
});
