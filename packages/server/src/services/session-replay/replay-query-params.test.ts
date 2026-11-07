import { describe, expect, it } from "vitest";
import { MAX_COMPARED_MODELS } from "@agent-cost-analyzer/domain";
import {
  MAX_REPLAY_MODEL_ID_LENGTH,
  parseCompareQuery,
  parseReplayQuery,
} from "./replay-query-params.js";

// Phase 14 step 14.5 (plan §9, threat-model.md §4): the replay routes'
// query, shared by HTTP, the webview RPC and MCP so all three validate the
// same way and report the same messages.
describe("parseReplayQuery", () => {
  it("takes a trimmed model, an optional pricing and an optional provider", () => {
    expect(
      parseReplayQuery({
        model: "  claude-haiku-5.5 ",
        pricing: "api",
        provider: "claude-code",
      }),
    ).toEqual({
      ok: true,
      value: {
        model: "claude-haiku-5.5",
        pricing: "api",
        providerId: "claude-code",
      },
    });
    expect(parseReplayQuery({ model: "m" })).toEqual({
      ok: true,
      value: { model: "m" },
    });
  });

  it("accepts providerId as MCP names it", () => {
    expect(parseReplayQuery({ model: "m", providerId: "vscode" })).toEqual({
      ok: true,
      value: { model: "m", providerId: "vscode" },
    });
  });

  it("refuses a missing, empty, blank, repeated or overlong model", () => {
    for (const model of [
      undefined,
      "",
      "   ",
      ["a", "b"],
      "x".repeat(MAX_REPLAY_MODEL_ID_LENGTH + 1),
    ]) {
      const parsed = parseReplayQuery({ model });
      expect(parsed.ok, String(model)).toBe(false);
    }
    const missing = parseReplayQuery({});
    expect(!missing.ok && missing.error).toMatch(/^model: /);
  });

  it("refuses an unknown pricing", () => {
    const parsed = parseReplayQuery({ model: "m", pricing: "contract" });
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.error).toMatch(/^pricing: /);
  });
});

describe("parseCompareQuery", () => {
  it("takes models comma-separated or as an array, trimmed and deduplicated", () => {
    expect(parseCompareQuery({ models: "a, b,,a ,c" })).toEqual({
      ok: true,
      value: { models: ["a", "b", "c"] },
    });
    expect(
      parseCompareQuery({
        models: [" a", "b", "a"],
        pricing: "copilot",
        provider: "vscode",
      }),
    ).toEqual({
      ok: true,
      value: { models: ["a", "b"], pricing: "copilot", providerId: "vscode" },
    });
  });

  it("refuses no models", () => {
    for (const models of [undefined, "", " , ", []]) {
      const parsed = parseCompareQuery({ models });
      expect(parsed.ok, JSON.stringify(models)).toBe(false);
      expect(!parsed.ok && parsed.error).toMatch(/^models: /);
    }
  });

  it(`caps the models at ${MAX_COMPARED_MODELS} after removing repeats`, () => {
    const ids = (count: number) =>
      Array.from({ length: count }, (_, i) => `m${i}`);
    expect(parseCompareQuery({ models: ids(MAX_COMPARED_MODELS) }).ok).toBe(
      true,
    );
    expect(
      parseCompareQuery({ models: [...ids(MAX_COMPARED_MODELS), "m0"] }).ok,
    ).toBe(true);
    const over = parseCompareQuery({
      models: ids(MAX_COMPARED_MODELS + 1).join(","),
    });
    expect(over.ok).toBe(false);
    expect(!over.ok && over.error).toMatch(/at most 10/i);
  });

  it("refuses a non-string or overlong model id in the list and a bad pricing", () => {
    expect(parseCompareQuery({ models: ["a", 3] }).ok).toBe(false);
    expect(
      parseCompareQuery({ models: "x".repeat(MAX_REPLAY_MODEL_ID_LENGTH + 1) })
        .ok,
    ).toBe(false);
    expect(parseCompareQuery({ models: "a", pricing: "free" }).ok).toBe(false);
  });
});
