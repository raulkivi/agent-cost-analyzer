import { describe, expect, it } from "vitest";
import { unavailableTokenCount, type CopilotEventLogStatus, type Session, type Turn } from "@agent-cost-analyzer/domain";
import {
  AGENT_HOST_TEXT_UNAVAILABLE_REASON,
  AGENT_HOST_TOOL_CALLS_UNAVAILABLE_REASON,
  textUnavailableReason,
  toolCallsUnavailableReason,
  turnTextUnavailableReason,
  turnToolCallsUnavailableReason,
} from "./tool-calls-availability.js";

const unknown = unavailableTokenCount("n/a");
const turn: Turn = {
  index: 0,
  userMessage: "",
  assistantResponse: "",
  toolCalls: [],
  usage: {
    uncachedInput: unknown,
    cacheWrite: unknown,
    cacheRead: unknown,
    tool: unknown,
    vision: unknown,
    reasoning: unknown,
    output: unknown,
    costAiCredits: unknown,
    model: "m",
  },
  explanation: "",
};

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "s",
    mode: "analyze",
    title: "t",
    model: "m",
    turns: [turn],
    turnCount: 1,
    costAiCredits: unknown,
    usageDataAvailable: false,
    ...overrides,
  };
}

const agentHost = (copilotEventLog?: CopilotEventLogStatus) =>
  session({ copilotHarness: "agent-host", ...(copilotEventLog ? { copilotEventLog } : {}) });

describe("session-level availability", () => {
  it("is known for sessions that aren't Agent Host sessions", () => {
    for (const s of [session(), session({ copilotHarness: "local" })]) {
      expect(toolCallsUnavailableReason(s)).toBeUndefined();
      expect(textUnavailableReason(s)).toBeUndefined();
    }
  });

  it("is known for an Agent Host session whose event log was read", () => {
    const s = agentHost({ status: "read" });

    expect(toolCallsUnavailableReason(s)).toBeUndefined();
    expect(textUnavailableReason(s)).toBeUndefined();
  });

  it("gives the marker's reason when the event log is missing or unreadable", () => {
    expect(toolCallsUnavailableReason(agentHost({ status: "missing", reason: "no log" }))).toBe("no log");
    expect(textUnavailableReason(agentHost({ status: "unreadable", reason: "EACCES" }))).toBe("EACCES");
  });

  it("stays unknown for an Agent Host session without a marker (its log was never read)", () => {
    expect(toolCallsUnavailableReason(agentHost())).toBe(AGENT_HOST_TOOL_CALLS_UNAVAILABLE_REASON);
    expect(textUnavailableReason(agentHost())).toBe(AGENT_HOST_TEXT_UNAVAILABLE_REASON);
  });
});

describe("turn-level availability", () => {
  it("prefers the turn's own reason, so one unmatched turn of a read log stays unknown", () => {
    const s = agentHost({ status: "read" });
    const unmatched = { ...turn, textUnavailableReason: "no text", toolCallsUnavailableReason: "no calls" };

    expect(turnTextUnavailableReason(s, unmatched)).toBe("no text");
    expect(turnToolCallsUnavailableReason(s, unmatched)).toBe("no calls");
    expect(turnTextUnavailableReason(s, turn)).toBeUndefined();
    expect(turnToolCallsUnavailableReason(s, turn)).toBeUndefined();
  });

  it("falls back to the session's reason", () => {
    const s = agentHost({ status: "missing", reason: "no log" });

    expect(turnTextUnavailableReason(s, turn)).toBe("no log");
    expect(turnToolCallsUnavailableReason(s, turn)).toBe("no log");
  });
});
