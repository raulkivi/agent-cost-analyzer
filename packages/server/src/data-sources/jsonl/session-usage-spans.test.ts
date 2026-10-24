import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readMainJsonlEnvelopes } from "./main-jsonl-reader.js";
import type { JsonlEnvelope } from "./main-jsonl-reader.js";
import type { AgentTraceUsage } from "../agent-traces/agent-traces-reader.js";
import {
  AGENT_TRACES_UNAVAILABLE_REASON,
  AI_CREDITS_NOT_AVAILABLE_REASON,
  collectResponseIds,
  extractTurnUsages,
  groupEnvelopesByUserMessage,
  USAGE_CATEGORY_NOT_EXPOSED_REASON,
} from "./session-usage-spans.js";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/jsonl",
);
const realSessionPath = path.join(fixturesDir, "real-session-with-usage.jsonl");

describe("groupEnvelopesByUserMessage", () => {
  it("starts a new group at each user_message event", async () => {
    const envelopes = await readMainJsonlEnvelopes(realSessionPath);

    const groups = groupEnvelopesByUserMessage(envelopes);

    expect(groups).toHaveLength(2);
    expect(groups[0][0].type).toBe("user_message");
    expect(groups[0].every((e) => e.spanId !== "0000000000000015")).toBe(true);
    expect(groups[1][0].spanId).toBe("0000000000000015");
  });

  it("returns an empty array when there is no user_message event", () => {
    const envelopes: JsonlEnvelope[] = [
      { type: "session_start" },
      { type: "discovery" },
    ];

    expect(groupEnvelopesByUserMessage(envelopes)).toEqual([]);
  });
});

describe("extractTurnUsages", () => {
  it("sums every llm_request span within a turn's group (real fixture, 2 requests per turn)", async () => {
    const envelopes = await readMainJsonlEnvelopes(realSessionPath);

    const [turn0, turn1] = extractTurnUsages(envelopes);

    // No agentTraceUsageByResponseId map passed (default empty) — cacheWrite/
    // reasoning fall back to the actionable agent-traces reason, not the old
    // blanket "not exposed" one (that stays for tool/vision, still genuinely
    // unexposed by anything).
    expect(turn0).toEqual({
      uncachedInput: { known: true, value: 21370 },
      cacheWrite: { known: false, reason: AGENT_TRACES_UNAVAILABLE_REASON },
      cacheRead: { known: true, value: 42559 },
      tool: { known: false, reason: USAGE_CATEGORY_NOT_EXPOSED_REASON },
      vision: { known: false, reason: USAGE_CATEGORY_NOT_EXPOSED_REASON },
      reasoning: { known: false, reason: AGENT_TRACES_UNAVAILABLE_REASON },
      output: { known: true, value: 1146 },
      costAiCredits: { known: true, value: 7.33953 },
      model: "claude-sonnet-5",
      roundsCount: 2,
    });
    expect(turn1).toEqual({
      uncachedInput: { known: true, value: 1835 },
      cacheWrite: { known: false, reason: AGENT_TRACES_UNAVAILABLE_REASON },
      cacheRead: { known: true, value: 70461 },
      tool: { known: false, reason: USAGE_CATEGORY_NOT_EXPOSED_REASON },
      vision: { known: false, reason: USAGE_CATEGORY_NOT_EXPOSED_REASON },
      reasoning: { known: false, reason: AGENT_TRACES_UNAVAILABLE_REASON },
      output: { known: true, value: 440 },
      costAiCredits: { known: true, value: 2.30782 },
      model: "claude-sonnet-5",
      roundsCount: 2,
    });
  });

  it("counts roundsCount as the number of usable llm_request spans in the turn's group", () => {
    const envelopes: JsonlEnvelope[] = [
      { type: "user_message", spanId: "u1" },
      {
        type: "llm_request",
        spanId: "r1",
        attrs: { inputTokens: 100, outputTokens: 10, cachedTokens: 0 },
      },
      { type: "tool_call", spanId: "t1" },
      {
        type: "llm_request",
        spanId: "r2",
        attrs: { inputTokens: 50, outputTokens: 5, cachedTokens: 0 },
      },
      {
        type: "llm_request",
        spanId: "r3",
        attrs: { inputTokens: 20, outputTokens: 2, cachedTokens: 0 },
      },
    ];

    const [turn0] = extractTurnUsages(envelopes);

    expect(turn0?.roundsCount).toBe(3);
  });

  it("returns null for a turn whose group has no usable llm_request span", () => {
    const envelopes: JsonlEnvelope[] = [
      { type: "user_message", spanId: "u1" },
      { type: "tool_call", spanId: "t1" },
    ];

    expect(extractTurnUsages(envelopes)).toEqual([null]);
  });

  it("returns null for a turn whose only llm_request span has an older/unknown attrs shape", () => {
    const envelopes: JsonlEnvelope[] = [
      { type: "user_message", spanId: "u1" },
      { type: "llm_request", spanId: "r1", attrs: { foo: "bar" } },
    ];

    expect(extractTurnUsages(envelopes)).toEqual([null]);
  });

  it("returns an empty array when there is no user_message event", () => {
    expect(extractTurnUsages([{ type: "session_start" }])).toEqual([]);
  });

  it("prefers the latest request with a known model over a later request missing attrs.model", () => {
    const envelopes: JsonlEnvelope[] = [
      { type: "user_message", spanId: "u1" },
      {
        type: "llm_request",
        spanId: "r1",
        attrs: {
          model: "claude-sonnet-5",
          inputTokens: 100,
          outputTokens: 10,
          cachedTokens: 0,
        },
      },
      {
        type: "llm_request",
        spanId: "r2",
        attrs: { inputTokens: 50, outputTokens: 5, cachedTokens: 0 },
      },
    ];

    const [turn0] = extractTurnUsages(envelopes);

    expect(turn0?.model).toBe("claude-sonnet-5");
  });

  it("falls back to 'unknown' only when none of the turn's requests have a known model", () => {
    const envelopes: JsonlEnvelope[] = [
      { type: "user_message", spanId: "u1" },
      {
        type: "llm_request",
        spanId: "r1",
        attrs: { inputTokens: 100, outputTokens: 10, cachedTokens: 0 },
      },
      {
        type: "llm_request",
        spanId: "r2",
        attrs: { inputTokens: 50, outputTokens: 5, cachedTokens: 0 },
      },
    ];

    const [turn0] = extractTurnUsages(envelopes);

    expect(turn0?.model).toBe("unknown");
    expect(turn0?.costAiCredits).toEqual({
      known: false,
      reason: AI_CREDITS_NOT_AVAILABLE_REASON,
    });
  });

  describe("agent-traces enrichment (2nd param)", () => {
    function envelopesWithResponseIds(responseIds: (string | undefined)[]): JsonlEnvelope[] {
      return [
        { type: "user_message", spanId: "u1" },
        ...responseIds.map((responseId, i) => ({
          type: "llm_request",
          spanId: `r${i}`,
          attrs: {
            model: "claude-sonnet-5",
            inputTokens: 100,
            outputTokens: 10,
            cachedTokens: 0,
            ...(responseId !== undefined ? { responseId } : {}),
          },
        })),
      ];
    }

    it("populates cacheWrite/reasoning as known when every request's responseId matches the map", () => {
      const envelopes = envelopesWithResponseIds(["resp-a", "resp-b"]);
      const map = new Map<string, AgentTraceUsage>([
        ["resp-a", { cacheWrite: 100, reasoning: 5 }],
        ["resp-b", { cacheWrite: 50, reasoning: 3 }],
      ]);

      const [turn0] = extractTurnUsages(envelopes, map);

      expect(turn0?.cacheWrite).toEqual({ known: true, value: 150 });
      expect(turn0?.reasoning).toEqual({ known: true, value: 8 });
    });

    it("degrades the whole turn to unavailable when any request's responseId has no map entry", () => {
      const envelopes = envelopesWithResponseIds(["resp-a", "resp-missing"]);
      const map = new Map<string, AgentTraceUsage>([
        ["resp-a", { cacheWrite: 100, reasoning: 5 }],
      ]);

      const [turn0] = extractTurnUsages(envelopes, map);

      expect(turn0?.cacheWrite).toEqual({
        known: false,
        reason: AGENT_TRACES_UNAVAILABLE_REASON,
      });
      expect(turn0?.reasoning).toEqual({
        known: false,
        reason: AGENT_TRACES_UNAVAILABLE_REASON,
      });
    });

    it("degrades the whole turn to unavailable when a request has no responseId at all (older/unknown shape)", () => {
      const envelopes = envelopesWithResponseIds(["resp-a", undefined]);
      const map = new Map<string, AgentTraceUsage>([
        ["resp-a", { cacheWrite: 100, reasoning: 5 }],
      ]);

      const [turn0] = extractTurnUsages(envelopes, map);

      expect(turn0?.cacheWrite).toEqual({
        known: false,
        reason: AGENT_TRACES_UNAVAILABLE_REASON,
      });
    });

    it("does not affect uncachedInput/cacheRead/output/costAiCredits/model", () => {
      const envelopes = envelopesWithResponseIds(["resp-a"]);
      const map = new Map<string, AgentTraceUsage>([
        ["resp-a", { cacheWrite: 100, reasoning: 5 }],
      ]);

      const [turn0] = extractTurnUsages(envelopes, map);

      expect(turn0?.uncachedInput).toEqual({ known: true, value: 100 });
      expect(turn0?.cacheRead).toEqual({ known: true, value: 0 });
      expect(turn0?.output).toEqual({ known: true, value: 10 });
      expect(turn0?.model).toBe("claude-sonnet-5");
    });
  });
});

describe("collectResponseIds", () => {
  it("dedupes non-null responseIds across llm_request envelopes", () => {
    const envelopes: JsonlEnvelope[] = [
      { type: "user_message", spanId: "u1" },
      {
        type: "llm_request",
        spanId: "r1",
        attrs: { inputTokens: 1, outputTokens: 1, responseId: "resp-a" },
      },
      {
        type: "llm_request",
        spanId: "r2",
        attrs: { inputTokens: 1, outputTokens: 1, responseId: "resp-a" },
      },
      {
        type: "llm_request",
        spanId: "r3",
        attrs: { inputTokens: 1, outputTokens: 1, responseId: "resp-b" },
      },
    ];

    expect(collectResponseIds(envelopes)).toEqual(["resp-a", "resp-b"]);
  });

  it("ignores llm_request envelopes without a responseId and non-llm_request envelopes", () => {
    const envelopes: JsonlEnvelope[] = [
      { type: "user_message", spanId: "u1" },
      { type: "llm_request", spanId: "r1", attrs: { inputTokens: 1, outputTokens: 1 } },
      { type: "tool_call", spanId: "t1", attrs: { responseId: "not-an-llm-request" } },
    ];

    expect(collectResponseIds(envelopes)).toEqual([]);
  });

  it("returns an empty array for no envelopes", () => {
    expect(collectResponseIds([])).toEqual([]);
  });
});
