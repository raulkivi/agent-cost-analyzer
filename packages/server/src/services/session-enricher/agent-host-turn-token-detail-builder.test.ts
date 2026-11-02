import { describe, expect, it } from "vitest";
import type { CopilotEvent } from "../../data-sources/agent-host/copilot-event.js";
import {
  AGENT_HOST_CACHE_WRITE_NOT_REPORTED_REASON,
  AGENT_HOST_REASONING_NOT_REPORTED_REASON,
  AGENT_HOST_USAGE_RECORDS_INCOMPLETE_REASON,
  AGENT_HOST_USAGE_RECORDS_MISSING_REASON,
  AGENT_HOST_USAGE_RECORDS_NO_TOTALS_REASON,
  buildAgentHostTurnTokenDetail,
} from "./agent-host-turn-token-detail-builder.js";

interface RecordOptions {
  input?: number;
  cacheRead?: number;
  output?: number;
  cacheWrite?: number | null;
  reasoning?: number | null;
  cacheDetailsReported?: boolean;
}

function usageEvent(options: RecordOptions = {}): CopilotEvent {
  const { input = 100, cacheRead = 40, output = 20, cacheWrite = 10, reasoning = 5, cacheDetailsReported = true } = options;
  const usage: Record<string, unknown> = { inputTokens: input, cacheReadTokens: cacheRead, outputTokens: output, cacheDetailsReported };
  if (cacheWrite !== null) usage.cacheWriteTokens = cacheWrite;
  if (reasoning !== null) usage.reasoningTokens = reasoning;
  return { id: "e", type: "session.usage_record", parentId: null, timestamp: null, agentId: null, data: { usage } };
}

const other: CopilotEvent = { id: "o", type: "assistant.message", parentId: null, timestamp: null, agentId: null, data: {} };
const known = (value: number) => ({ known: true, value });

describe("buildAgentHostTurnTokenDetail", () => {
  it("rule 1: no session.db totals makes both unknown", () => {
    const detail = buildAgentHostTurnTokenDetail([usageEvent()], null);
    const expected = { known: false, reason: AGENT_HOST_USAGE_RECORDS_NO_TOTALS_REASON };
    expect(detail.cacheWrite).toEqual(expected);
    expect(detail.reasoning).toEqual(expected);
  });

  it("rule 1 wins over rule 2", () => {
    expect(buildAgentHostTurnTokenDetail([], null).cacheWrite).toMatchObject({ reason: AGENT_HOST_USAGE_RECORDS_NO_TOTALS_REASON });
  });

  it("rule 2: no usage records makes both unknown", () => {
    const detail = buildAgentHostTurnTokenDetail([other], { input: 100, cached: 40, output: 20 });
    const expected = { known: false, reason: AGENT_HOST_USAGE_RECORDS_MISSING_REASON };
    expect(detail.cacheWrite).toEqual(expected);
    expect(detail.reasoning).toEqual(expected);
  });

  it.each([
    ["input", { input: 90 }],
    ["cache read", { cacheRead: 30 }],
    ["output", { output: 25 }],
  ])("rule 3: a differing %s sum makes both unknown, not the partial sum", (_name, override) => {
    const detail = buildAgentHostTurnTokenDetail([usageEvent(override)], { input: 100, cached: 40, output: 20 });
    const expected = { known: false, reason: AGENT_HOST_USAGE_RECORDS_INCOMPLETE_REASON };
    expect(detail.cacheWrite).toEqual(expected);
    expect(detail.reasoning).toEqual(expected);
  });

  it("rule 4: sums cache write and reasoning across reconciling records, ignoring other events", () => {
    const events = [
      usageEvent({ input: 60, cacheRead: 20, output: 8, cacheWrite: 10, reasoning: 0 }),
      other,
      usageEvent({ input: 40, cacheRead: 20, output: 12, cacheWrite: 5, reasoning: 7 }),
    ];
    const detail = buildAgentHostTurnTokenDetail(events, { input: 100, cached: 40, output: 20 });
    expect(detail.cacheWrite).toEqual(known(15));
    expect(detail.reasoning).toEqual(known(7));
  });

  it("rule 4: zero is a known value", () => {
    const detail = buildAgentHostTurnTokenDetail([usageEvent({ cacheWrite: 0, reasoning: 0 })], { input: 100, cached: 40, output: 20 });
    expect(detail.cacheWrite).toEqual(known(0));
    expect(detail.reasoning).toEqual(known(0));
  });

  it("rule 4: a record without cache write makes only cache write unknown", () => {
    const detail = buildAgentHostTurnTokenDetail([usageEvent({ cacheDetailsReported: false })], { input: 100, cached: 40, output: 20 });
    expect(detail.cacheWrite).toEqual({ known: false, reason: AGENT_HOST_CACHE_WRITE_NOT_REPORTED_REASON });
    expect(detail.reasoning).toEqual(known(5));
  });

  it("rule 4: one record missing reasoning makes only reasoning unknown", () => {
    const events = [usageEvent({ input: 60, cacheRead: 20, output: 8 }), usageEvent({ input: 40, cacheRead: 20, output: 12, reasoning: null })];
    const detail = buildAgentHostTurnTokenDetail(events, { input: 100, cached: 40, output: 20 });
    expect(detail.reasoning).toEqual({ known: false, reason: AGENT_HOST_REASONING_NOT_REPORTED_REASON });
    expect(detail.cacheWrite).toEqual(known(20));
  });

  it("rule 4: cache write above input minus cached makes cache write unknown", () => {
    const detail = buildAgentHostTurnTokenDetail([usageEvent({ cacheWrite: 61 })], { input: 100, cached: 40, output: 20 });
    expect(detail.cacheWrite).toEqual({ known: false, reason: AGENT_HOST_USAGE_RECORDS_INCOMPLETE_REASON });
    expect(detail.reasoning).toEqual(known(5));
  });

  it("rule 4: cache write equal to input minus cached is known", () => {
    const detail = buildAgentHostTurnTokenDetail([usageEvent({ cacheWrite: 60 })], { input: 100, cached: 40, output: 20 });
    expect(detail.cacheWrite).toEqual(known(60));
  });
});
