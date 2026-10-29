import { describe, expect, it } from "vitest";
import { turnSchema } from "./turn.js";

const usage = {
  uncachedInput: { known: true, value: 120 },
  cacheWrite: { known: true, value: 30 },
  cacheRead: { known: true, value: 30 },
  tool: { known: true, value: 15 },
  vision: { known: true, value: 0 },
  reasoning: { known: true, value: 0 },
  output: { known: true, value: 200 },
  costAiCredits: { known: true, value: 2.79598 },
  model: "gpt-4o",
};

describe("turnSchema", () => {
  it("accepts a minimal turn with no tool calls or triggered event", () => {
    const sample = {
      index: 0,
      userMessage: "What does this function do?",
      assistantResponse: "It parses the config file.",
      toolCalls: [],
      usage,
      explanation: "The user asked a question, the assistant answered directly.",
    };

    expect(turnSchema.parse(sample)).toEqual(sample);
  });

  it("accepts a turn with tool calls and a triggered event", () => {
    const sample = {
      index: 1,
      userMessage: "Switch to a cheaper model.",
      assistantResponse: "Switched to gpt-4o-mini.",
      toolCalls: [{ name: "read_file", argsSummary: "read settings.json" }],
      usage,
      explanation: "The user requested a model switch.",
      triggeredEvent: "model-switch",
    };

    expect(turnSchema.parse(sample)).toEqual(sample);
  });

  it("accepts the reasons a turn's text and tool calls are unknown", () => {
    const sample = {
      index: 0,
      userMessage: "",
      assistantResponse: "",
      toolCalls: [],
      usage,
      explanation: "tokens only",
      textUnavailableReason: "no user message in the log",
      toolCallsUnavailableReason: "no user message in the log",
    };

    expect(turnSchema.parse(sample)).toEqual(sample);
  });

  it("rejects an invalid triggeredEvent value", () => {
    const sample = {
      index: 0,
      userMessage: "hi",
      assistantResponse: "hello",
      toolCalls: [],
      usage,
      explanation: "greeting",
      triggeredEvent: "not-a-real-event",
    };

    expect(() => turnSchema.parse(sample)).toThrow();
  });
});
