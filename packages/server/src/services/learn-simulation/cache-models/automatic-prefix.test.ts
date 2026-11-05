import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { CachingKind } from "@agent-cost-analyzer/domain";
import { AutomaticPrefixCacheModel } from "./automatic-prefix.js";
import { buildPrompt } from "../prompt-builder.js";

type Kind = Extract<CachingKind, { kind: "automatic-prefix" }>;
const kind: Kind = {
  kind: "automatic-prefix",
  ttlMinutes: { min: 5, max: 10 },
  writeCharged: false,
  minCacheableTokens: 1024,
  incrementTokens: 128,
};
const model = (overrides: Partial<Kind> = {}) =>
  new AutomaticPrefixCacheModel({ ...kind, ...overrides });
const prompt = (tools: number, system: number, messages: number) =>
  buildPrompt({ tools, system, messages });

describe("AutomaticPrefixCacheModel", () => {
  it("S7: first request is a miss; the write is billed as plain input when no write charge", () => {
    const r = model().request({ prompt: prompt(1000, 500, 200), atMinute: 0 });
    expect(r).toMatchObject({
      cacheRead: 0,
      cacheWrite: 0,
      uncachedInput: 1700,
      outcome: "miss",
    });
  });

  it("S7: reports the write in cacheWrite when the vendor charges for it", () => {
    const r = model({ writeCharged: true }).request({
      prompt: prompt(1000, 500, 200),
      atMinute: 0,
    });
    // Cached prefix is floored to the 128-token increment: 1664.
    expect(r).toMatchObject({ cacheWrite: 1664, uncachedInput: 36 });
  });

  it("S7: a grown conversation reads the old increment-aligned prefix", () => {
    const m = model();
    m.request({ prompt: prompt(1000, 500, 200), atMinute: 0 });
    const r = m.request({ prompt: prompt(1000, 500, 900), atMinute: 1 });
    expect(r).toMatchObject({
      cacheRead: 1664,
      cacheWrite: 0,
      uncachedInput: 2400 - 1664,
      outcome: "hit",
    });
  });

  it("S7: caches exact length when no increment is defined", () => {
    const m = model({ incrementTokens: undefined, writeCharged: true });
    const r = m.request({ prompt: prompt(1000, 500, 200), atMinute: 0 });
    expect(r.cacheWrite).toBe(1700);
  });

  it("S7: nothing is cached below the minimum", () => {
    const m = model();
    m.request({ prompt: prompt(300, 200, 100), atMinute: 0 });
    const r = m.request({ prompt: prompt(300, 200, 150), atMinute: 1 });
    expect(r).toMatchObject({ cacheRead: 0, uncachedInput: 650 });
  });

  it("S7: invalidatedFrom keeps only the aligned prefix before that layer", () => {
    const m = model();
    m.request({ prompt: prompt(1000, 500, 200), atMinute: 0 });
    const r = m.request({
      prompt: prompt(1000, 500, 300),
      atMinute: 1,
      invalidatedFrom: "system",
    });
    // Prefix before system is 1000 tokens, floored to 896.
    expect(r).toMatchObject({ cacheRead: 896, outcome: "partial" });
  });

  it("S7: expires after the guaranteed minimum idle time and refreshes on hit", () => {
    const m = model();
    m.request({ prompt: prompt(1000, 500, 200), atMinute: 0 });
    expect(
      m.request({ prompt: prompt(1000, 500, 300), atMinute: 4 }).outcome,
    ).toBe("hit");
    expect(
      m.request({ prompt: prompt(1000, 500, 400), atMinute: 8 }).outcome,
    ).toBe("hit");
    expect(
      m.request({ prompt: prompt(1000, 500, 500), atMinute: 14 }).outcome,
    ).toBe("miss");
  });

  it("S7: a fixed TTL is used as given", () => {
    const m = model({ ttlMinutes: { fixed: 60 } });
    m.request({ prompt: prompt(1000, 500, 200), atMinute: 0 });
    expect(
      m.request({ prompt: prompt(1000, 500, 300), atMinute: 59 }).outcome,
    ).toBe("hit");
  });

  it("S2: read + write + uncached always equals the prompt, for random histories", () => {
    const step = fc.record({
      tools: fc.integer({ min: 0, max: 5000 }),
      system: fc.integer({ min: 0, max: 5000 }),
      messages: fc.integer({ min: 0, max: 50_000 }),
      gap: fc.double({ min: 0, max: 30, noNaN: true }),
      invalidatedFrom: fc.option(
        fc.constantFrom("tools", "system", "messages"),
        { nil: undefined },
      ),
      writeCharged: fc.boolean(),
    });
    fc.assert(
      fc.property(fc.array(step, { minLength: 1, maxLength: 12 }), (steps) => {
        for (const charged of [false, true]) {
          const m = model({ writeCharged: charged });
          let now = 0;
          for (const s of steps) {
            now += s.gap;
            const p = prompt(s.tools, s.system, s.messages);
            const r = m.request({
              prompt: p,
              atMinute: now,
              invalidatedFrom: s.invalidatedFrom,
            });
            expect(
              r.cacheRead +
                r.cacheWrite +
                r.extendedCacheWrite +
                r.uncachedInput,
            ).toBe(p.totalTokens);
            expect(r.cacheRead).toBeLessThanOrEqual(p.totalTokens);
          }
        }
      }),
    );
  });
});
