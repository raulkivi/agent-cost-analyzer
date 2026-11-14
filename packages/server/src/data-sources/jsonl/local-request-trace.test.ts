// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { requestTraceSchema } from "@agent-cost-analyzer/domain";
import { readMainJsonlFile, type JsonlEnvelope } from "./main-jsonl-reader.js";
import { buildLocalCacheBreakTrace, buildLocalRequestTrace, HELPER_AGENTS_ONLY_REASON, MAIN_AGENT_DEBUG_NAME, NOT_IN_DEBUG_LOG_REASON, promptFileNames, UNUSABLE_REQUEST_REASON } from "./local-request-trace.js";

// Phase 14 step 14.2 (docs/plans/analyze-session-replay.md §4.1, §5): a
// local-harness Copilot session as one record per llm_request span of its
// debug log (main.jsonl), placed in the session's turns by the same
// alignment readSession uses (log-turn-alignment.ts).
const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/jsonl/real-session-with-usage.jsonl");

// The fixture predates debugName; its requests are the main agent's.
async function mainAgentEnvelopes(): Promise<JsonlEnvelope[]> {
  const { envelopes } = await readMainJsonlFile(fixture);
  return envelopes.map((envelope) => (envelope.type === "llm_request" ? { ...envelope, attrs: { ...envelope.attrs, debugName: MAIN_AGENT_DEBUG_NAME } } : envelope));
}

describe("buildLocalRequestTrace", () => {
  it("gives each llm_request its session turn, with writes unknown without agent-traces.db", async () => {
    const envelopes = await mainAgentEnvelopes();

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
    const envelopes = await mainAgentEnvelopes();

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
    const envelopes = await mainAgentEnvelopes();

    // Logging started at the session's third turn.
    const trace = buildLocalRequestTrace({ sessionId: "s1", envelopes, alignment: [2, 3], sessionTurnIndexes: [0, 1, 2, 3], agentTraceUsage: new Map() });

    expect([...new Set(trace.requests.map((r) => r.turnIndex))]).toEqual([2, 3]);
    expect(trace.notTraced).toEqual([
      { turnIndex: 0, reason: NOT_IN_DEBUG_LOG_REASON },
      { turnIndex: 1, reason: NOT_IN_DEBUG_LOG_REASON },
    ]);
  });

  it("leaves out a log turn it can't place, so no request is put in the wrong turn", async () => {
    const envelopes = await mainAgentEnvelopes();

    const trace = buildLocalRequestTrace({ sessionId: "s1", envelopes, alignment: [null, null], sessionTurnIndexes: [0, 1], agentTraceUsage: new Map() });

    expect(trace.requests).toEqual([]);
    expect(trace.notTraced.map((t) => t.turnIndex)).toEqual([0, 1]);
  });

  // Owner decision 2026-11-14 (analyze-session-replay.md §13, finding 1): the
  // helper agents (todo list, conversation summary, ...) have prompts of their
  // own, so the replay's chain is the main agent's, by SR6's rule; the helpers'
  // requests are counted, with their AI Credits, for the coverage line.
  it("keeps the main agent's requests only and counts the helper agents' requests with their AI Credits", () => {
    let ts = 1_786_200_000_000;
    const user = (): JsonlEnvelope => ({ type: "user_message", ts: (ts += 1000), attrs: {} });
    const request = (debugName: string, input: number, nano: number): JsonlEnvelope => ({
      type: "llm_request",
      ts: (ts += 1000),
      attrs: { model: debugName === "backgroundTodoAgent" ? "gpt-4o-mini" : "claude-sonnet-5", debugName, inputTokens: input, cachedTokens: 0, outputTokens: 5, copilotUsageNanoAiu: nano },
    });
    const envelopes = [
      user(),
      request(MAIN_AGENT_DEBUG_NAME, 1000, 1_000_000_000),
      request("backgroundTodoAgent", 200, 50_000_000),
      request(MAIN_AGENT_DEBUG_NAME, 1100, 1_000_000_000),
      user(),
      request("summarizeConversationHistory", 1200, 200_000_000),
    ];

    const trace = buildLocalRequestTrace({ sessionId: "s1", envelopes, alignment: [0, 1], sessionTurnIndexes: [0, 1], agentTraceUsage: new Map() });

    expect(requestTraceSchema.parse(trace)).toEqual(trace);
    expect(trace.requests.map((r) => [r.turnIndex, r.uncachedInput, r.model])).toEqual([
      [0, 1000, "claude-sonnet-5"],
      [0, 1100, "claude-sonnet-5"],
    ]);
    expect(trace.requests.some((r) => r.event === "model-switch")).toBe(false);
    expect(trace.notTraced).toEqual([{ turnIndex: 1, reason: HELPER_AGENTS_ONLY_REASON }]);
    expect(trace.helperRequests?.requests).toBe(2);
    const cost = trace.helperRequests?.costAiCredits;
    expect(cost?.known).toBe(true);
    expect(cost?.known && cost.value).toBeCloseTo(0.25, 12);
  });

  it("counts a request with no agent name as a helper's, and unknown AI Credits as unknown, never 0", () => {
    const envelopes: JsonlEnvelope[] = [
      { type: "user_message", ts: 1, attrs: {} },
      { type: "llm_request", ts: 2, attrs: { model: "m", debugName: MAIN_AGENT_DEBUG_NAME, inputTokens: 10, cachedTokens: 0, outputTokens: 1 } },
      { type: "llm_request", ts: 3, attrs: { model: "m", inputTokens: 10, cachedTokens: 0, outputTokens: 1 } },
    ];

    const trace = buildLocalRequestTrace({ sessionId: "s1", envelopes, alignment: [0], sessionTurnIndexes: [0], agentTraceUsage: new Map() });

    expect(trace.requests).toHaveLength(1);
    expect(trace.helperRequests?.requests).toBe(1);
    expect(trace.helperRequests?.costAiCredits.known).toBe(false);
  });

  it("omits the helper count when every request is the main agent's", async () => {
    const trace = buildLocalRequestTrace({ sessionId: "s1", envelopes: await mainAgentEnvelopes(), alignment: [0, 1], sessionTurnIndexes: [0, 1], agentTraceUsage: new Map() });
    expect(trace.helperRequests).toBeUndefined();
  });

  it("leaves out a turn with a span missing its cache-read count or time, never zeroing it", async () => {
    const envelopes = await mainAgentEnvelopes();
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

// Phase 16 SR6 (docs/plans/savings-report.md §4 O3, §15 a): the main agent's
// chain (`debugName` panel/editAgent) with what changed in each prompt, from
// content hashes of the prompt and tools files and the "Custom Instructions"
// event. Other agents (summariser, todo agent) have their own prompts and are
// left out. Synthetic envelopes only.
describe("buildLocalCacheBreakTrace", () => {
  let ts = 1_786_200_000_000;
  const user = (digest: string): JsonlEnvelope => ({ type: "user_message", ts: (ts += 1000), attrs: { contentDigest: digest } });
  const instructions = (details: string): JsonlEnvelope => ({ type: "generic", name: "Custom Instructions", ts: (ts += 1000), attrs: { details } });
  const request = (files: { systemPromptFile: string; toolsFile: string }, debugName = MAIN_AGENT_DEBUG_NAME): JsonlEnvelope => ({
    type: "llm_request",
    ts: (ts += 1000),
    attrs: { model: "claude-sonnet-5", debugName, inputTokens: 1000, cachedTokens: 900, outputTokens: 10, ...files },
  });
  const files = (system: string, tools: string) => ({ systemPromptFile: system, toolsFile: tools });
  const base = { sessionId: "s1", alignment: [0], sessionTurnIndexes: [0], agentTraceUsage: new Map() };

  it("keeps the main agent's requests only, with the debugName read from the log", () => {
    const envelopes = [user("a"), request(files("s1.json", "t1.json")), request(files("x.json", "y.json"), "summarizeConversationHistory"), request(files("s1.json", "t1.json"))];

    const { trace } = buildLocalCacheBreakTrace({ ...base, envelopes, fileHashes: new Map() });

    expect(trace.requests.map((r) => r.index)).toEqual([0, 1]);
    expect(requestTraceSchema.parse(trace)).toEqual(trace);
  });

  it("marks tools and system prompt changed by content hash, not by file name", () => {
    const envelopes = [user("a"), request(files("s1.json", "t1.json")), request(files("s2.json", "t2.json")), request(files("s3.json", "t2b.json"))];
    const fileHashes = new Map([
      ["s1.json", "S1"],
      ["s2.json", "S1"],
      ["s3.json", "S2"],
      ["t1.json", "T1"],
      ["t2.json", "T2"],
      ["t2b.json", "T2"],
    ]);

    const { promptChanges } = buildLocalCacheBreakTrace({ ...base, envelopes, fileHashes });

    expect(promptChanges.get(0)).toBeUndefined();
    expect(promptChanges.get(1)).toEqual({ tools: true, systemPrompt: false });
    expect(promptChanges.get(2)).toEqual({ tools: false, systemPrompt: true });
  });

  it("marks instructions changed only when the Custom Instructions text changed too; unchanged is recorded as false", () => {
    const envelopes = [
      user("a"),
      instructions("context included: [1] CLAUDE.md"),
      request(files("s1.json", "t1.json")),
      request(files("s2.json", "t1.json")),
      instructions("context included: [2] CLAUDE.md, AGENTS.md"),
      request(files("s3.json", "t1.json")),
    ];
    const fileHashes = new Map([
      ["s1.json", "S1"],
      ["s2.json", "S2"],
      ["s3.json", "S3"],
      ["t1.json", "T1"],
    ]);

    const { promptChanges } = buildLocalCacheBreakTrace({ ...base, envelopes, fileHashes });

    expect(promptChanges.get(1)).toEqual({ tools: false, systemPrompt: true, instructions: false });
    expect(promptChanges.get(2)).toEqual({ tools: false, systemPrompt: true, instructions: true });
  });

  it("records nothing for a signal whose file could not be read, and keeps no text in a marker", () => {
    const envelopes = [user("a"), instructions("SECRET INSTRUCTIONS"), request(files("s1.json", "t1.json")), request(files("s2.json", "t2.json"))];
    const fileHashes = new Map<string, string | null>([
      ["s1.json", null],
      ["s2.json", "S2"],
      ["t1.json", "T1"],
      ["t2.json", "T2"],
    ]);

    const { promptChanges } = buildLocalCacheBreakTrace({ ...base, envelopes, fileHashes });

    expect(promptChanges.get(1)).toEqual({ tools: true, instructions: false });
    expect(JSON.stringify([...promptChanges])).not.toContain("SECRET");
  });

  it("lists the distinct prompt and tools file names of the main agent's requests", () => {
    const envelopes = [user("a"), request(files("s1.json", "t1.json")), request(files("s1.json", "t2.json")), request(files("sx.json", "tx.json"), "backgroundTodoAgent")];

    expect(promptFileNames(envelopes).sort()).toEqual(["s1.json", "t1.json", "t2.json"]);
  });
});
