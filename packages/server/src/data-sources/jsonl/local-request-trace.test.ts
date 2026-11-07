import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { requestTraceSchema } from "@agent-cost-analyzer/domain";
import { readMainJsonlFile } from "./main-jsonl-reader.js";
import { buildLocalRequestTrace, NOT_IN_DEBUG_LOG_REASON, UNUSABLE_REQUEST_REASON } from "./local-request-trace.js";

// Phase 14 step 14.2 (docs/plans/analyze-session-replay.md §4.1, §5): a
// local-harness Copilot session as one record per llm_request span of its
// debug log (main.jsonl), placed in the session's turns by the same
// alignment readSession uses (log-turn-alignment.ts).
const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/jsonl/real-session-with-usage.jsonl");

describe("buildLocalRequestTrace", () => {
  it("gives each llm_request its session turn, with writes unknown without agent-traces.db", async () => {
    const { envelopes } = await readMainJsonlFile(fixture);

    const trace = buildLocalRequestTrace({ sessionId: "s1", envelopes, alignment: [0, 1], sessionTurnIndexes: [0, 1], agentTraceUsage: new Map() });

    expect(requestTraceSchema.parse(trace)).toEqual(trace);
    expect(trace.harness).toBe("vscode-local");
    expect(trace.requests.map((r) => [r.turnIndex, r.uncachedInput, r.cacheRead, r.cacheWrite, r.output])).toEqual([
      [0, 16100, 13230, null, 254],
      [0, 5270, 29329, null, 892],
      [1, 1268, 34597, null, 396],
      [1, 567, 35864, null, 44],
    ]);
    expect(trace.requests[0]).toMatchObject({ startedAt: new Date(1786202790374).toISOString(), model: "claude-sonnet-5" });
    expect(trace.notTraced).toEqual([]);
  });

  it("takes cache writes and reasoning from agent-traces.db, out of the uncached input", async () => {
    const { envelopes } = await readMainJsonlFile(fixture);

    const trace = buildLocalRequestTrace({
      sessionId: "s1",
      envelopes,
      alignment: [0, 1],
      sessionTurnIndexes: [0, 1],
      agentTraceUsage: new Map([["redacted-response-id", { cacheWrite: 100, reasoning: 10 }]]),
    });

    expect(trace.requests[0]).toMatchObject({ uncachedInput: 16000, cacheWrite: 100, reasoning: 10 });
  });

  it("uses the session's own turn indexes, and lists turns the log doesn't cover", async () => {
    const { envelopes } = await readMainJsonlFile(fixture);

    // Logging started at the session's third turn.
    const trace = buildLocalRequestTrace({ sessionId: "s1", envelopes, alignment: [2, 3], sessionTurnIndexes: [0, 1, 2, 3], agentTraceUsage: new Map() });

    expect([...new Set(trace.requests.map((r) => r.turnIndex))]).toEqual([2, 3]);
    expect(trace.notTraced).toEqual([
      { turnIndex: 0, reason: NOT_IN_DEBUG_LOG_REASON },
      { turnIndex: 1, reason: NOT_IN_DEBUG_LOG_REASON },
    ]);
  });

  it("leaves out a log turn it can't place, so no request is put in the wrong turn", async () => {
    const { envelopes } = await readMainJsonlFile(fixture);

    const trace = buildLocalRequestTrace({ sessionId: "s1", envelopes, alignment: [null, null], sessionTurnIndexes: [0, 1], agentTraceUsage: new Map() });

    expect(trace.requests).toEqual([]);
    expect(trace.notTraced.map((t) => t.turnIndex)).toEqual([0, 1]);
  });

  it("leaves out a turn with a span missing its cache-read count or time, never zeroing it", async () => {
    const { envelopes } = await readMainJsonlFile(fixture);
    let seen = 0;
    const broken = envelopes.map((envelope) => {
      if (envelope.type !== "llm_request" || seen++ !== 1) return envelope;
      const attrs = { ...envelope.attrs };
      delete attrs.cachedTokens;
      return { ...envelope, attrs };
    });

    const trace = buildLocalRequestTrace({ sessionId: "s1", envelopes: broken, alignment: [0, 1], sessionTurnIndexes: [0, 1], agentTraceUsage: new Map() });

    expect(trace.requests.map((r) => r.turnIndex)).toEqual([1, 1]);
    expect(trace.notTraced).toEqual([{ turnIndex: 0, reason: UNUSABLE_REQUEST_REASON }]);
  });
});
