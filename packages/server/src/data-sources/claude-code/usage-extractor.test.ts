// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";
import type { ClaudeCodeTurnGroup } from "./turn-grouper.js";
import { extractTurnUsage } from "./usage-extractor.js";

function userText(uuid: string, text = "hi"): ClaudeCodeRawEntry {
  return { type: "user", uuid, message: { role: "user", content: [{ type: "text", text }] } };
}

// One content block of one assistant response. Real captures show the full
// `usage` object repeated identically across every block sharing one
// message.id (it describes the whole response, not the block) — so tests
// pass the same usage object to every block of a round, matching that.
function assistantBlock(
  uuid: string,
  messageId: string,
  block: Record<string, unknown>,
  usage?: Record<string, unknown>,
  model = "claude-sonnet-5",
): ClaudeCodeRawEntry {
  return { type: "assistant", uuid, message: { id: messageId, role: "assistant", model, content: [block], usage } };
}

function group(entries: ClaudeCodeRawEntry[]): ClaudeCodeTurnGroup {
  return { userMessageEntry: entries[0], entries };
}

describe("extractTurnUsage", () => {
  it("sums input/output/cacheRead/cacheWrite once per round (not once per content-block entry)", () => {
    const usage1 = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 0 };
    const usage2 = { input_tokens: 50, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 200 };
    const g = group([
      userText("u1"),
      // Round 1 (message id m1): two content blocks sharing usage1 — must
      // count once, not twice.
      assistantBlock("a1", "m1", { type: "thinking", thinking: "..." }, usage1),
      assistantBlock("a2", "m1", { type: "text", text: "ok" }, usage1),
      // Round 2 (message id m2): usage2.
      assistantBlock("a3", "m2", { type: "text", text: "done" }, usage2),
    ]);

    const usage = extractTurnUsage(g);

    expect(usage.uncachedInput).toEqual({ known: true, value: 150 });
    expect(usage.output).toEqual({ known: true, value: 30 });
    expect(usage.cacheRead).toEqual({ known: true, value: 5 });
    expect(usage.cacheWrite).toEqual({ known: true, value: 200 });
    expect(usage.roundsCount).toBe(2);
  });

  it("marks a field unavailable when any round in the turn is missing it (e.g. usage stripped entirely)", () => {
    const g = group([userText("u1"), assistantBlock("a1", "m1", { type: "text", text: "ok" }, undefined)]);

    const usage = extractTurnUsage(g);

    expect(usage.uncachedInput.known).toBe(false);
    expect(usage.output.known).toBe(false);
    expect(usage.cacheRead.known).toBe(false);
    expect(usage.cacheWrite.known).toBe(false);
    expect(usage.reasoning.known).toBe(false);
  });

  it("sums output_tokens_details.thinking_tokens as reasoning, marked known", () => {
    const usage = { input_tokens: 1, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens_details: { thinking_tokens: 7 } };
    const g = group([userText("u1"), assistantBlock("a1", "m1", { type: "thinking", thinking: "x" }, usage)]);

    expect(extractTurnUsage(g).reasoning).toEqual({ known: true, value: 7 });
  });

  it("uses the last round's model, falling back to unknown when there are no rounds", () => {
    const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    const g = group([
      userText("u1"),
      assistantBlock("a1", "m1", { type: "text", text: "a" }, usage, "model-a"),
      assistantBlock("a2", "m2", { type: "text", text: "b" }, usage, "model-b"),
    ]);
    expect(extractTurnUsage(g).model).toBe("model-b");

    expect(extractTurnUsage(group([userText("u1")])).model).toBe("unknown");
    expect(extractTurnUsage(group([userText("u1")])).roundsCount).toBe(0);
  });

  it("leaves a synthetic round (model <synthetic>, written by the CLI after an interruption) out of the model and the round count", () => {
    const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    const zero = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    const g = group([
      userText("u1"),
      assistantBlock("a1", "m1", { type: "text", text: "a" }, usage, "model-a"),
      assistantBlock("s1", "m2", { type: "text", text: "made-up notice" }, zero, "<synthetic>"),
    ]);

    const result = extractTurnUsage(g);
    expect(result.model).toBe("model-a");
    expect(result.roundsCount).toBe(1);
    expect(result.output).toEqual({ known: true, value: 1 });
  });

  it("costAiCredits, tool, and vision are always unavailable — no Copilot AI Credits or tool/vision separation exists", () => {
    const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    const g = group([userText("u1"), assistantBlock("a1", "m1", { type: "text", text: "a" }, usage)]);

    const result = extractTurnUsage(g);
    expect(result.costAiCredits.known).toBe(false);
    expect(result.tool.known).toBe(false);
    expect(result.vision.known).toBe(false);
  });

  describe("extendedCacheWrite (step 15.6: the 1-hour cache writes, priced higher)", () => {
    const base = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 };

    it("sums cache_creation.ephemeral_1h_input_tokens once per round", () => {
      const r1 = { ...base, cache_creation_input_tokens: 300, cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 200 } };
      const r2 = { ...base, cache_creation_input_tokens: 50, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 50 } };
      const g = group([
        userText("u1"),
        assistantBlock("a1", "m1", { type: "thinking", thinking: "x" }, r1),
        assistantBlock("a2", "m1", { type: "text", text: "ok" }, r1),
        assistantBlock("a3", "m2", { type: "text", text: "done" }, r2),
      ]);
      expect(extractTurnUsage(g).extendedCacheWrite).toEqual({ known: true, value: 250 });
    });

    it("counts a round with no cache write as 0 even without the breakdown", () => {
      const g = group([userText("u1"), assistantBlock("a1", "m1", { type: "text", text: "ok" }, { ...base, cache_creation_input_tokens: 0 })]);
      expect(extractTurnUsage(g).extendedCacheWrite).toEqual({ known: true, value: 0 });
    });

    it("is unknown, with a reason, when a round wrote cache without the breakdown", () => {
      const g = group([userText("u1"), assistantBlock("a1", "m1", { type: "text", text: "ok" }, { ...base, cache_creation_input_tokens: 10 })]);
      const extended = extractTurnUsage(g).extendedCacheWrite;
      expect(extended?.known).toBe(false);
      if (extended && !extended.known) expect(extended.reason).toMatch(/1-hour/);
    });
  });
});
