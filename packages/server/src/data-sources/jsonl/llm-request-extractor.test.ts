import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readMainJsonlEnvelopes } from "./main-jsonl-reader.js";
import { extractLlmRequestUsage } from "./llm-request-extractor.js";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/jsonl",
);
const llmRequestSamplePath = path.join(fixturesDir, "llm-request-sample.jsonl");

describe("extractLlmRequestUsage", () => {
  it("splits a real captured llm_request span's inputTokens into uncached vs. cached", async () => {
    const [envelope] = await readMainJsonlEnvelopes(llmRequestSamplePath);

    const usage = extractLlmRequestUsage(envelope);

    // real captured attrs include copilotUsageNanoAiu 2795980000
    expect(usage).toEqual({
      uncachedInput: 5270,
      cacheRead: 29329,
      output: 892,
      aiCredits: 2.79598,
      model: "claude-sonnet-5",
      responseId: "redacted-response-id",
    });
  });

  it("treats a zero cachedTokens request as entirely uncached input", () => {
    const usage = extractLlmRequestUsage({
      type: "llm_request",
      attrs: {
        model: "claude-sonnet-5",
        inputTokens: 33044,
        outputTokens: 183,
        cachedTokens: 0,
      },
    });

    expect(usage).toEqual({
      uncachedInput: 33044,
      cacheRead: 0,
      output: 183,
      aiCredits: null,
      model: "claude-sonnet-5",
      responseId: null,
    });
  });

  // Agent-traces enrichment (Phase 8.5) joins this back to agent-traces.db
  // spans by responseId — an older/unrecognized shape without it must not
  // throw, just degrade to null (constraint 6: never fabricate a join key).
  it("extracts responseId when present, distinct from the model/token fields", () => {
    const usage = extractLlmRequestUsage({
      type: "llm_request",
      attrs: {
        model: "gpt-4o",
        inputTokens: 100,
        outputTokens: 10,
        cachedTokens: 0,
        responseId: "abc-123",
      },
    });

    expect(usage?.responseId).toBe("abc-123");
  });

  it("returns a null responseId when the attr is missing or not a string", () => {
    expect(
      extractLlmRequestUsage({
        type: "llm_request",
        attrs: { inputTokens: 100, outputTokens: 10 },
      })?.responseId,
    ).toBeNull();

    expect(
      extractLlmRequestUsage({
        type: "llm_request",
        attrs: { inputTokens: 100, outputTokens: 10, responseId: 42 },
      })?.responseId,
    ).toBeNull();
  });

  it("returns null for a non-llm_request envelope", () => {
    expect(
      extractLlmRequestUsage({
        type: "tool_call",
        attrs: { args: "{}", result: "ok" },
      }),
    ).toBeNull();
  });

  it("returns null for an llm_request span missing inputTokens/outputTokens (older/unknown shape)", () => {
    expect(
      extractLlmRequestUsage({
        type: "llm_request",
        attrs: { foo: "bar" },
      }),
    ).toBeNull();
  });

  it("returns null when attrs is missing entirely", () => {
    expect(extractLlmRequestUsage({ type: "llm_request" })).toBeNull();
  });

  it("falls back to 'unknown' when model is missing", () => {
    const usage = extractLlmRequestUsage({
      type: "llm_request",
      attrs: { inputTokens: 100, outputTokens: 10, cachedTokens: 0 },
    });

    expect(usage?.model).toBe("unknown");
  });
});
