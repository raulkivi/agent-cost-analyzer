// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { BestEffortCacheModel } from "./best-effort.js";
import { buildPrompt } from "../prompt-builder.js";

const kind = { kind: "best-effort" as const, note: "n" };
const prompt = (tools: number, system: number, messages: number) =>
  buildPrompt({ tools, system, messages });

describe("BestEffortCacheModel", () => {
  it("S17: matches the prefix exactly, with no minimum and no write charge", () => {
    const m = new BestEffortCacheModel(kind, { assumedTtlMinutes: 10 });
    const first = m.request({ prompt: prompt(100, 50, 20), atMinute: 0 });
    expect(first).toMatchObject({
      cacheRead: 0,
      cacheWrite: 0,
      uncachedInput: 170,
      outcome: "miss",
    });
    const second = m.request({ prompt: prompt(100, 50, 70), atMinute: 1 });
    expect(second).toMatchObject({
      cacheRead: 170,
      cacheWrite: 0,
      uncachedInput: 50,
      outcome: "hit",
    });
  });

  it("S17: lifetime is the injected assumed TTL", () => {
    const m = new BestEffortCacheModel(kind, { assumedTtlMinutes: 10 });
    m.request({ prompt: prompt(100, 50, 20), atMinute: 0 });
    expect(
      m.request({ prompt: prompt(100, 50, 30), atMinute: 9 }).outcome,
    ).toBe("hit");
    expect(
      m.request({ prompt: prompt(100, 50, 40), atMinute: 20 }).outcome,
    ).toBe("miss");
  });

  it("S17: invalidatedFrom keeps only the prefix before that layer", () => {
    const m = new BestEffortCacheModel(kind, { assumedTtlMinutes: 10 });
    m.request({ prompt: prompt(100, 50, 20), atMinute: 0 });
    const r = m.request({
      prompt: prompt(100, 50, 30),
      atMinute: 1,
      invalidatedFrom: "system",
    });
    expect(r).toMatchObject({ cacheRead: 100, outcome: "partial" });
  });
});
