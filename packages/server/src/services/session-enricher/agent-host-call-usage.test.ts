import { describe, expect, it } from "vitest";
import type { CopilotEvent } from "../../data-sources/agent-host/copilot-event.js";
import { readCopilotCallUsage } from "./agent-host-call-usage.js";

function usageEvent(usage: unknown, extra: Partial<CopilotEvent> = {}): CopilotEvent {
  return {
    id: "ur1",
    type: "session.usage_record",
    parentId: "ts1",
    timestamp: "2026-11-02T10:00:00.000Z",
    agentId: null,
    data: { usage },
    ...extra,
  };
}

// Shaped like a record from Copilot CLI 1.0.103 (vscode-extension.md step 10.15).
const realUsage = {
  model: "claude-sonnet-4.6",
  apiCallId: "call_0001",
  inputTokens: 12000,
  cacheReadTokens: 9000,
  cacheWriteTokens: 1500,
  outputTokens: 400,
  reasoningTokens: 120,
  cacheDetailsReported: true,
  copilotUsage: { totalNanoAiu: 1234, tokenDetails: [] },
  initiator: "agent",
  finishReason: "tool_calls",
  isByok: false,
};

describe("readCopilotCallUsage", () => {
  it("reads a real-shaped session.usage_record", () => {
    expect(readCopilotCallUsage(usageEvent(realUsage))).toEqual({
      apiCallId: "call_0001",
      inputTokens: 12000,
      cacheReadTokens: 9000,
      outputTokens: 400,
      cacheWriteTokens: 1500,
      reasoningTokens: 120,
    });
  });

  it("returns null for any other event type", () => {
    expect(readCopilotCallUsage(usageEvent(realUsage, { type: "assistant.message" }))).toBeNull();
  });

  it("returns null when data.usage is missing, an array, or not an object", () => {
    expect(readCopilotCallUsage(usageEvent(undefined))).toBeNull();
    expect(readCopilotCallUsage(usageEvent(null))).toBeNull();
    expect(readCopilotCallUsage(usageEvent("usage"))).toBeNull();
    expect(readCopilotCallUsage(usageEvent(42))).toBeNull();
    expect(readCopilotCallUsage(usageEvent([realUsage]))).toBeNull();
  });

  it("returns null when data itself is missing usage", () => {
    const event = { ...usageEvent(realUsage), data: {} };
    expect(readCopilotCallUsage(event)).toBeNull();
  });

  it.each(["inputTokens", "cacheReadTokens", "outputTokens"])(
    "returns null when %s is missing",
    (field) => {
      const usage: Record<string, unknown> = { ...realUsage };
      delete usage[field];
      expect(readCopilotCallUsage(usageEvent(usage))).toBeNull();
    },
  );

  it.each([
    ["a string", "12000"],
    ["negative", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["null", null],
  ])("returns null when a required count is %s", (_label, value) => {
    for (const field of ["inputTokens", "cacheReadTokens", "outputTokens"]) {
      expect(readCopilotCallUsage(usageEvent({ ...realUsage, [field]: value }))).toBeNull();
    }
  });

  it("accepts zero for required counts", () => {
    const r = readCopilotCallUsage(
      usageEvent({ ...realUsage, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0 }),
    );
    expect(r).toMatchObject({ inputTokens: 0, cacheReadTokens: 0, outputTokens: 0 });
  });

  it("nulls cache write when cacheDetailsReported is false, even with a count", () => {
    const r = readCopilotCallUsage(usageEvent({ ...realUsage, cacheDetailsReported: false }));
    expect(r).not.toBeNull();
    expect(r!.cacheWriteTokens).toBeNull();
    expect(r!.inputTokens).toBe(12000);
  });

  it("keeps cache write when cacheDetailsReported is absent", () => {
    const usage: Record<string, unknown> = { ...realUsage };
    delete usage.cacheDetailsReported;
    expect(readCopilotCallUsage(usageEvent(usage))!.cacheWriteTokens).toBe(1500);
  });

  it.each([
    ["missing", undefined],
    ["a string", "1500"],
    ["negative", -5],
    ["NaN", Number.NaN],
    ["null", null],
  ])("nulls cache write when it is %s", (_label, value) => {
    const usage = { ...realUsage, cacheWriteTokens: value };
    expect(readCopilotCallUsage(usageEvent(usage))!.cacheWriteTokens).toBeNull();
  });

  it("keeps a zero cache write as a value", () => {
    expect(readCopilotCallUsage(usageEvent({ ...realUsage, cacheWriteTokens: 0 }))!.cacheWriteTokens).toBe(0);
  });

  it("keeps a zero reasoning count as a value", () => {
    expect(readCopilotCallUsage(usageEvent({ ...realUsage, reasoningTokens: 0 }))!.reasoningTokens).toBe(0);
  });

  it.each([
    ["missing", undefined],
    ["a string", "120"],
    ["negative", -1],
    ["NaN", Number.NaN],
    ["null", null],
  ])("nulls reasoning when it is %s", (_label, value) => {
    const usage = { ...realUsage, reasoningTokens: value };
    expect(readCopilotCallUsage(usageEvent(usage))!.reasoningTokens).toBeNull();
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["a number", 7],
    ["null", null],
  ])("nulls apiCallId when it is %s", (_label, value) => {
    expect(readCopilotCallUsage(usageEvent({ ...realUsage, apiCallId: value }))!.apiCallId).toBeNull();
  });

  it("reads a subagent event like any other", () => {
    const r = readCopilotCallUsage(usageEvent(realUsage, { agentId: "agent-7" }));
    expect(r).toMatchObject({ apiCallId: "call_0001", inputTokens: 12000 });
  });

  it("never throws on a hostile data shape", () => {
    const event = { ...usageEvent(realUsage), data: null } as unknown as CopilotEvent;
    expect(readCopilotCallUsage(event)).toBeNull();
  });
});
