// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { turnUsageSchema } from "./turn-usage.js";

describe("turnUsageSchema", () => {
  it("accepts a turn usage with known and unknown token counts mixed", () => {
    const sample = {
      uncachedInput: { known: true, value: 120 },
      cacheWrite: { known: true, value: 30 },
      cacheRead: { known: false, reason: "main.jsonl parsing not yet implemented" },
      tool: { known: true, value: 15 },
      vision: { known: false, reason: "no vision attachments this turn" },
      reasoning: { known: true, value: 0 },
      output: { known: true, value: 200 },
      costAiCredits: { known: true, value: 2.79598 },
      model: "gpt-4o",
    };

    expect(turnUsageSchema.parse(sample)).toEqual(sample);
  });

  it("accepts an optional roundsCount and omits it when absent", () => {
    const withRounds = turnUsageSchema.parse({
      uncachedInput: { known: true, value: 120 },
      cacheWrite: { known: true, value: 30 },
      cacheRead: { known: true, value: 30 },
      tool: { known: true, value: 15 },
      vision: { known: true, value: 0 },
      reasoning: { known: true, value: 0 },
      output: { known: true, value: 200 },
      costAiCredits: { known: true, value: 2.79598 },
      model: "gpt-4o",
      roundsCount: 3,
    });
    expect(withRounds.roundsCount).toBe(3);

    const withoutRounds = turnUsageSchema.parse({
      uncachedInput: { known: true, value: 120 },
      cacheWrite: { known: true, value: 30 },
      cacheRead: { known: true, value: 30 },
      tool: { known: true, value: 15 },
      vision: { known: true, value: 0 },
      reasoning: { known: true, value: 0 },
      output: { known: true, value: 200 },
      costAiCredits: { known: true, value: 2.79598 },
      model: "gpt-4o",
    });
    expect(withoutRounds.roundsCount).toBeUndefined();
  });

  it("rejects a turn usage missing a required field", () => {
    const missingModel = {
      uncachedInput: { known: true, value: 120 },
      cacheWrite: { known: true, value: 30 },
      cacheRead: { known: true, value: 30 },
      tool: { known: true, value: 15 },
      vision: { known: true, value: 0 },
      reasoning: { known: true, value: 0 },
      output: { known: true, value: 200 },
      costAiCredits: { known: true, value: 2.79598 },
    };

    expect(() => turnUsageSchema.parse(missingModel)).toThrow();
  });

  it("accepts the optional 1-hour cache-write subset and the agent's own reported cost (step 15.6)", () => {
    const base = {
      uncachedInput: { known: true, value: 120 },
      cacheWrite: { known: true, value: 30 },
      cacheRead: { known: true, value: 30 },
      tool: { known: false, reason: "x" },
      vision: { known: false, reason: "x" },
      reasoning: { known: true, value: 0 },
      output: { known: true, value: 200 },
      costAiCredits: { known: false, reason: "not Copilot" },
      model: "claude-sonnet-5.5",
    };
    const parsed = turnUsageSchema.parse({
      ...base,
      extendedCacheWrite: { known: true, value: 20 },
      reportedCostUsd: { known: false, reason: "no cost in this log" },
    });
    expect(parsed.extendedCacheWrite).toEqual({ known: true, value: 20 });
    expect(parsed.reportedCostUsd).toEqual({ known: false, reason: "no cost in this log" });
    expect(turnUsageSchema.parse(base).extendedCacheWrite).toBeUndefined();
  });
});
