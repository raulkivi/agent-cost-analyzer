import { describe, expect, it } from "vitest";
import * as domain from "./index.js";
import { requestTraceSchema, type RequestTrace } from "./request-trace.js";

// Phase 14 step 14.1 (docs/plans/analyze-session-replay.md §4.1): one LLM
// request per record, numbers only, in the session's main chain.
function trace(overrides: Partial<RequestTrace> = {}): RequestTrace {
  return {
    sessionId: "s1",
    providerId: "claude-code",
    harness: "claude-code",
    requests: [
      { index: 0, turnIndex: 0, startedAt: "2026-10-07T09:00:00.000Z", model: "claude-sonnet-5.5", uncachedInput: 120, cacheRead: 0, cacheWrite: 9000, output: 400 },
      { index: 1, turnIndex: 0, startedAt: "2026-10-07T09:00:20.000Z", model: "claude-sonnet-5.5", uncachedInput: 30, cacheRead: 9120, cacheWrite: 400, extendedCacheWrite: 400, output: 250, reasoning: 80 },
      { index: 2, turnIndex: 1, startedAt: "2026-10-07T09:12:00.000Z", model: "claude-sonnet-5.5", uncachedInput: 50, cacheRead: 2000, cacheWrite: 1200, output: 300, event: "compaction" },
    ],
    notTraced: [{ turnIndex: 2, reason: "The log has no token counts for this turn." }],
    ...overrides,
  };
}

describe("requestTraceSchema", () => {
  it("accepts a trace with 1-hour writes, reasoning, an event and an untraced turn", () => {
    expect(requestTraceSchema.parse(trace())).toEqual(trace());
  });

  it("rejects text: a record holds numbers, a model id and a time only", () => {
    const withText = { ...trace().requests[0]!, userMessage: "hello" };
    expect(requestTraceSchema.safeParse(trace({ requests: [withText] })).success).toBe(false);
  });

  it("rejects negative or fractional token counts", () => {
    for (const bad of [-1, 1.5]) {
      const request = { ...trace().requests[0]!, cacheRead: bad };
      expect(requestTraceSchema.safeParse(trace({ requests: [request] })).success).toBe(false);
    }
  });

  it("rejects 1-hour writes larger than all writes", () => {
    const request = { ...trace().requests[1]!, extendedCacheWrite: 401 };
    expect(requestTraceSchema.safeParse(trace({ requests: [request] })).success).toBe(false);
  });

  it("requires indexes 0, 1, 2… in order, and times that never go back", () => {
    const [a, b] = trace().requests;
    expect(requestTraceSchema.safeParse(trace({ requests: [a!, { ...b!, index: 3 }] })).success).toBe(false);
    expect(requestTraceSchema.safeParse(trace({ requests: [a!, { ...b!, startedAt: "2026-10-07T08:59:00.000Z" }] })).success).toBe(false);
  });

  it("requires turn indexes that never go back", () => {
    const [a, b] = trace().requests;
    expect(requestTraceSchema.safeParse(trace({ requests: [{ ...a!, turnIndex: 1 }, { ...b!, turnIndex: 0 }] })).success).toBe(false);
  });

  it("allows an empty trace when every turn is untraced, with the reasons", () => {
    expect(requestTraceSchema.safeParse(trace({ requests: [], notTraced: [{ turnIndex: 0, reason: "No usage." }] })).success).toBe(true);
  });

  it("is exported from the domain index", () => {
    expect(domain.requestTraceSchema).toBe(requestTraceSchema);
  });
});
