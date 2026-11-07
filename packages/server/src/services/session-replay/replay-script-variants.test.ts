// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { ScenarioScript, ScriptStep } from "@agent-cost-analyzer/domain";
import { withoutModelSwitches } from "./replay-script-variants.js";

const step = (index: number, events: ScriptStep["events"]): ScriptStep => ({
  index,
  userMessage: "",
  assistantResponse: "",
  toolCalls: [],
  explanation: "",
  newContent: {
    userTokens: 10,
    toolResultTokens: 0,
    reasoningTokens: 0,
    outputTokens: 5,
  },
  events,
});

const script = (steps: ScriptStep[]): ScenarioScript => ({
  id: "s1",
  title: "s1",
  category: "replay",
  harnesses: ["claude-code"],
  sessionKind: "main",
  staticPrefix: { toolsTokens: 50, systemTokens: 50 },
  steps,
});

describe("withoutModelSwitches", () => {
  it("removes every model-switch event and keeps every other event", () => {
    const input = script([
      step(1, [
        { type: "model-switch", toRole: "cheaper" },
        { type: "extended-ttl" },
      ]),
      step(2, [{ type: "compaction", summaryTokens: 30 }]),
      step(3, [{ type: "clear" }, { type: "model-switch", toRole: "primary" }]),
    ]);
    const output = withoutModelSwitches(input);
    expect(output.steps.map((s) => s.events)).toEqual([
      [{ type: "extended-ttl" }],
      [{ type: "compaction", summaryTokens: 30 }],
      [{ type: "clear" }],
    ]);
    expect({ ...output, steps: [] }).toEqual({ ...input, steps: [] });
    expect(output.steps.map((s) => ({ ...s, events: [] }))).toEqual(
      input.steps.map((s) => ({ ...s, events: [] })),
    );
  });

  it("does not change its input", () => {
    const input = script([
      step(1, []),
      step(2, [{ type: "model-switch", toRole: "cheaper" }]),
    ]);
    const before = structuredClone(input);
    withoutModelSwitches(input);
    expect(input).toEqual(before);
  });
});
