import { describe, expect, it } from "vitest";
import {
  scenarioScriptSchema,
  scriptEventSchema,
  scriptStepSchema,
} from "./scenario-script.js";

function without<T extends object>(obj: T, key: keyof T): Partial<T> {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}

const newContent = {
  userTokens: 100,
  toolResultTokens: 0,
  reasoningTokens: 0,
  outputTokens: 50,
};

const step = {
  index: 0,
  userMessage: "hi",
  assistantResponse: "hello",
  toolCalls: [],
  explanation: "First turn writes the prefix.",
  newContent,
  events: [],
};

const script = {
  id: "s1",
  title: "Minimal",
  category: "basics",
  harnesses: ["vscode-local"],
  sessionKind: "main",
  staticPrefix: { toolsTokens: 5000, systemTokens: 3000 },
  steps: [step],
};

describe("scriptEventSchema", () => {
  const events = [
    { type: "model-switch", toRole: "cheaper" },
    { type: "model-switch", toRole: "primary" },
    { type: "tools-changed", deltaTokens: 400 },
    { type: "system-changed", deltaTokens: -50, cause: "edit" },
    { type: "system-changed", deltaTokens: 120, cause: "applyTo" },
    { type: "image-added" },
    { type: "image-removed" },
    { type: "thinking-changed", enabled: true },
    { type: "compaction", summaryTokens: 2000 },
    { type: "clear" },
    { type: "rewind", toStep: 2 },
    { type: "fork", branch: "b", fromStep: 3 },
    { type: "extended-ttl" },
  ];

  it.each(events)("round-trips $type", (event) => {
    expect(scriptEventSchema.parse(event)).toEqual(event);
  });

  it("rejects an unknown event type", () => {
    expect(scriptEventSchema.safeParse({ type: "teleport" }).success).toBe(
      false,
    );
  });

  it("rejects variant-specific field errors", () => {
    expect(
      scriptEventSchema.safeParse({
        type: "system-changed",
        deltaTokens: 1,
        cause: "other",
      }).success,
    ).toBe(false);
    expect(
      scriptEventSchema.safeParse({ type: "model-switch", toRole: "bigger" })
        .success,
    ).toBe(false);
    expect(
      scriptEventSchema.safeParse({ type: "fork", fromStep: 1 }).success,
    ).toBe(false);
    expect(scriptEventSchema.safeParse({ type: "compaction" }).success).toBe(
      false,
    );
  });
});

describe("scriptStepSchema", () => {
  it("accepts images with width and height and idleMinutesBefore", () => {
    const withImages = {
      ...step,
      idleMinutesBefore: 6,
      newContent: { ...newContent, images: [{ width: 1024, height: 768 }] },
      events: [{ type: "image-added" }],
    };
    expect(scriptStepSchema.safeParse(withImages).success).toBe(true);
  });

  it("rejects an image without height", () => {
    const bad = {
      ...step,
      newContent: { ...newContent, images: [{ width: 10 }] },
    };
    expect(scriptStepSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a step without newContent", () => {
    const rest = without(step, "newContent");
    expect(scriptStepSchema.safeParse(rest).success).toBe(false);
  });
});

describe("scenarioScriptSchema", () => {
  it("accepts a minimal script", () => {
    expect(scenarioScriptSchema.safeParse(script).success).toBe(true);
  });

  it("accepts textByHarness and a subagent with a parent", () => {
    const full = {
      ...script,
      harnesses: ["vscode-local", "claude-code"],
      sessionKind: "subagent",
      parentScenarioId: "s0",
      textByHarness: {
        "claude-code": {
          title: "CC title",
          userMessages: ["a"],
          explanations: ["b"],
        },
      },
    };
    expect(scenarioScriptSchema.safeParse(full).success).toBe(true);
  });

  it("rejects empty harnesses, a bad sessionKind or an unknown harness key", () => {
    expect(
      scenarioScriptSchema.safeParse({ ...script, harnesses: [] }).success,
    ).toBe(false);
    expect(
      scenarioScriptSchema.safeParse({ ...script, sessionKind: "other" })
        .success,
    ).toBe(false);
    expect(
      scenarioScriptSchema.safeParse({ ...script, harnesses: ["emacs"] })
        .success,
    ).toBe(false);
  });

  it("rejects a script without staticPrefix", () => {
    const rest = without(script, "staticPrefix");
    expect(scenarioScriptSchema.safeParse(rest).success).toBe(false);
  });
});

describe("harness text idle overrides (Claude Code's 1-hour cache)", () => {
  const script = {
    id: "s",
    title: "T",
    category: "C",
    harnesses: ["claude-code"],
    sessionKind: "main",
    staticPrefix: { toolsTokens: 1, systemTokens: 1 },
    steps: [step],
  };

  it("accepts per-step idle minutes, with null keeping the script's own gap", () => {
    const parsed = scenarioScriptSchema.parse({
      ...script,
      textByHarness: { "claude-code": { idleMinutes: [null, 70] } },
    });
    expect(parsed.textByHarness?.["claude-code"]?.idleMinutes).toEqual([null, 70]);
  });

  it("rejects a negative idle gap", () => {
    expect(() =>
      scenarioScriptSchema.parse({ ...script, textByHarness: { "claude-code": { idleMinutes: [-1] } } }),
    ).toThrow();
  });
});
