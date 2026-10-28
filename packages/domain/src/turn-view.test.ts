import { describe, expect, it } from "vitest";
import { turnViewSchema } from "./turn-view.js";

const usage = {
  uncachedInput: { known: true, value: 10 },
  cacheWrite: { known: true, value: 0 },
  cacheRead: { known: true, value: 90 },
  tool: { known: false, reason: "n/a" },
  vision: { known: false, reason: "n/a" },
  reasoning: { known: false, reason: "n/a" },
  output: { known: true, value: 5 },
  costAiCredits: { known: false, reason: "n/a" },
  model: "m",
};

describe("turnViewSchema", () => {
  it("accepts a bounded turn view", () => {
    const view = {
      sessionId: "s1",
      providerId: "claude-code",
      turnIndex: 0,
      turnCount: 1,
      model: "m",
      userMessage: "hello",
      userMessageTruncated: false,
      assistantResponse: "hi…",
      assistantResponseTruncated: true,
      explanation: "",
      usage,
      toolCalls: [{ name: "Bash", kind: "shell", status: "error", failureCategory: "timeout", exitCode: 124, command: "npm test", durationMs: 10 }],
    };
    expect(turnViewSchema.parse(view)).toEqual(view);
  });

  it("accepts the reasons text and tool calls are unavailable", () => {
    const view = {
      sessionId: "s1",
      turnIndex: 0,
      turnCount: 1,
      model: "m",
      userMessage: "",
      userMessageTruncated: false,
      assistantResponse: "",
      assistantResponseTruncated: false,
      explanation: "",
      usage,
      toolCalls: [],
      textUnavailableReason: "no text",
      toolCallsUnavailableReason: "no calls",
    };
    expect(turnViewSchema.parse(view)).toEqual(view);
  });
});
