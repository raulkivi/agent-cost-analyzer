// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { requestTraceSchema } from "@agent-cost-analyzer/domain";
import type { ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";
import { buildClaudeCodeRequestTrace, NO_USAGE_REASON, NO_REQUEST_REASON } from "./request-trace-builder.js";
import type { ClaudeCodeTurnGroup } from "./turn-grouper.js";

// Phase 14 step 14.2 (docs/plans/analyze-session-replay.md §4.1): one trace
// record per round (one LLM request, grouped by message.id), in the
// provider's own turns, so trace turn indexes are the session's.

function user(uuid: string): ClaudeCodeRawEntry {
  return { type: "user", uuid, timestamp: "2026-10-07T09:00:00.000Z", message: { role: "user", content: "hi" } } as ClaudeCodeRawEntry;
}

function assistant(id: string, at: string, usage: Record<string, unknown> | undefined, model = "claude-sonnet-5-5"): ClaudeCodeRawEntry {
  return { type: "assistant", uuid: `${id}-${at}`, timestamp: at, message: { id, model, role: "assistant", content: [], ...(usage ? { usage } : {}) } } as ClaudeCodeRawEntry;
}

const usage = (input: number, read: number, write: number, output: number, extra: Record<string, unknown> = {}) => ({
  input_tokens: input,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
  output_tokens: output,
  ...extra,
});

function group(...entries: ClaudeCodeRawEntry[]): ClaudeCodeTurnGroup {
  return { userMessageEntry: entries[0]!, entries };
}

describe("buildClaudeCodeRequestTrace", () => {
  it("makes one record per round, counting a response split into blocks once", () => {
    const trace = buildClaudeCodeRequestTrace("s1", [
      group(
        user("u1"),
        assistant("m1", "2026-10-07T09:00:03.000Z", usage(1250, 1500, 300, 120)),
        assistant("m1", "2026-10-07T09:00:03.500Z", usage(1250, 1500, 300, 120)),
        assistant("m2", "2026-10-07T09:00:08.000Z", usage(15, 1800, 0, 340)),
      ),
      group(user("u2"), assistant("m3", "2026-10-07T09:05:02.000Z", usage(1900, 3200, 150, 210))),
    ]);

    expect(requestTraceSchema.parse(trace)).toEqual(trace);
    expect(trace).toEqual({
      sessionId: "s1",
      providerId: "claude-code",
      harness: "claude-code",
      requests: [
        { index: 0, turnIndex: 0, startedAt: "2026-10-07T09:00:03.000Z", model: "claude-sonnet-5-5", uncachedInput: 1250, cacheRead: 1500, cacheWrite: 300, output: 120 },
        { index: 1, turnIndex: 0, startedAt: "2026-10-07T09:00:08.000Z", model: "claude-sonnet-5-5", uncachedInput: 15, cacheRead: 1800, cacheWrite: 0, output: 340 },
        { index: 2, turnIndex: 1, startedAt: "2026-10-07T09:05:02.000Z", model: "claude-sonnet-5-5", uncachedInput: 1900, cacheRead: 3200, cacheWrite: 150, output: 210 },
      ],
      notTraced: [],
    });
  });

  it("keeps 1-hour writes inside all writes, and reads thinking tokens as reasoning", () => {
    const trace = buildClaudeCodeRequestTrace("s1", [
      group(
        user("u1"),
        assistant("m1", "2026-10-07T09:00:03.000Z", usage(10, 0, 900, 50, { cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 800 }, output_tokens_details: { thinking_tokens: 30 } })),
      ),
    ]);

    expect(trace.requests[0]).toMatchObject({ cacheWrite: 900, extendedCacheWrite: 800, reasoning: 30 });
  });

  it("marks a model switch on the first request with the new model", () => {
    const trace = buildClaudeCodeRequestTrace("s1", [
      group(user("u1"), assistant("m1", "2026-10-07T09:00:03.000Z", usage(10, 0, 100, 5))),
      group(user("u2"), assistant("m2", "2026-10-07T09:01:00.000Z", usage(10, 0, 200, 5), "claude-opus-5-5"), assistant("m3", "2026-10-07T09:01:30.000Z", usage(10, 0, 50, 5), "claude-opus-5-5")),
    ]);

    expect(trace.requests.map((request) => request.event)).toEqual([undefined, "model-switch", undefined]);
  });

  it("leaves out a turn whose requests lack usage, with the reason, never as zeros", () => {
    const trace = buildClaudeCodeRequestTrace("s1", [
      group(user("u1"), assistant("m1", "2026-10-07T09:00:03.000Z", usage(10, 0, 100, 5))),
      group(user("u2"), assistant("m2", "2026-10-07T09:01:00.000Z", usage(10, 0, 100, 5)), assistant("m3", "2026-10-07T09:01:30.000Z", { input_tokens: 4 })),
      group(user("u3")),
      group(user("u4"), assistant("m4", "2026-10-07T09:03:00.000Z", usage(10, 120, 30, 5))),
    ]);

    expect(trace.requests.map((request) => [request.index, request.turnIndex])).toEqual([
      [0, 0],
      [1, 3],
    ]);
    expect(trace.notTraced).toEqual([
      { turnIndex: 1, reason: NO_USAGE_REASON },
      { turnIndex: 2, reason: NO_REQUEST_REASON },
    ]);
  });

  it("keeps times in order when a line was written out of order, so a gap never goes negative", () => {
    const trace = buildClaudeCodeRequestTrace("s1", [
      group(user("u1"), assistant("m1", "2026-10-07T09:00:05.000Z", usage(10, 0, 100, 5)), assistant("m2", "2026-10-07T09:00:04.000Z", usage(10, 110, 0, 5))),
    ]);

    expect(trace.requests.map((request) => request.startedAt)).toEqual(["2026-10-07T09:00:05.000Z", "2026-10-07T09:00:05.000Z"]);
    expect(requestTraceSchema.safeParse(trace).success).toBe(true);
  });

  it("leaves out a request with no valid time with the reason, never guessing one", () => {
    const trace = buildClaudeCodeRequestTrace("s1", [group(user("u1"), assistant("m1", "not a time", usage(10, 0, 100, 5)))]);

    expect(trace.requests).toEqual([]);
    expect(trace.notTraced).toEqual([{ turnIndex: 0, reason: NO_USAGE_REASON }]);
  });

  it("leaves out synthetic entries (model <synthetic>, written by the CLI itself): no request, no model switch", () => {
    const zero = usage(0, 0, 0, 0);
    const trace = buildClaudeCodeRequestTrace("s1", [
      group(user("u1"), assistant("m1", "2026-10-07T09:00:03.000Z", usage(10, 0, 100, 5)), assistant("syn1", "2026-10-07T09:00:04.000Z", zero, "<synthetic>")),
      group(user("u2"), assistant("syn2", "2026-10-07T09:01:00.000Z", zero, "<synthetic>")),
      group(user("u3"), assistant("m2", "2026-10-07T09:02:00.000Z", usage(10, 110, 0, 5))),
    ]);

    expect(trace.requests.map((request) => [request.turnIndex, request.model, request.event])).toEqual([
      [0, "claude-sonnet-5-5", undefined],
      [2, "claude-sonnet-5-5", undefined],
    ]);
    expect(trace.notTraced).toEqual([{ turnIndex: 1, reason: NO_REQUEST_REASON }]);
  });

  describe("compaction", () => {
    const boundary = (uuid: string): ClaudeCodeRawEntry => ({ type: "system", subtype: "compact_boundary", uuid, parentUuid: null, logicalParentUuid: "x", compactMetadata: { trigger: "manual", preTokens: 900 } }) as ClaudeCodeRawEntry;
    const summary = (uuid: string): ClaudeCodeRawEntry => ({ type: "user", uuid, isCompactSummary: true, message: { role: "user", content: "Made-up summary." } }) as ClaudeCodeRawEntry;

    it("marks the first request after a compaction boundary, in the next turn or the same one", () => {
      const trace = buildClaudeCodeRequestTrace("s1", [
        group(user("u1"), assistant("m1", "2026-10-07T09:00:03.000Z", usage(10, 900, 0, 5)), boundary("b1"), summary("cs1")),
        group(user("u2"), assistant("m2", "2026-10-07T09:01:00.000Z", usage(10, 0, 200, 5)), assistant("m3", "2026-10-07T09:01:30.000Z", usage(10, 200, 0, 5)), boundary("b2"), summary("cs2"), assistant("m4", "2026-10-07T09:02:00.000Z", usage(10, 0, 150, 5))),
      ]);

      expect(trace.requests.map((request) => [request.turnIndex, request.event])).toEqual([
        [0, undefined],
        [1, "compaction"],
        [1, undefined],
        [1, "compaction"],
      ]);
      expect(requestTraceSchema.safeParse(trace).success).toBe(true);
    });

    it("prefers compaction over model-switch when the request after a compaction also changes the model", () => {
      const trace = buildClaudeCodeRequestTrace("s1", [
        group(user("u1"), assistant("m1", "2026-10-07T09:00:03.000Z", usage(10, 900, 0, 5)), boundary("b1")),
        group(user("u2"), assistant("m2", "2026-10-07T09:01:00.000Z", usage(10, 0, 200, 5), "claude-opus-5-5")),
      ]);

      expect(trace.requests.map((request) => request.event)).toEqual([undefined, "compaction"]);
    });

    it("keeps the mark for the next traced request when the first one after the boundary is in a turn left out", () => {
      const trace = buildClaudeCodeRequestTrace("s1", [
        group(user("u1"), assistant("m1", "2026-10-07T09:00:03.000Z", usage(10, 900, 0, 5)), boundary("b1")),
        group(user("u2"), assistant("m2", "2026-10-07T09:01:00.000Z", { input_tokens: 4 })),
        group(user("u3"), assistant("m3", "2026-10-07T09:02:00.000Z", usage(10, 0, 200, 5))),
      ]);

      expect(trace.requests.map((request) => [request.turnIndex, request.event])).toEqual([
        [0, undefined],
        [2, "compaction"],
      ]);
    });
  });
});
