import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { Layer } from "@agent-cost-analyzer/domain";
import { BreakpointCacheModel } from "./breakpoint.js";
import { buildPrompt } from "../prompt-builder.js";

const kind = {
  kind: "breakpoints" as const,
  defaultTtlMinutes: 5,
  extendedTtlMinutes: 60,
  refreshOnHit: true,
  minCacheableTokens: 1024,
  layers: ["tools", "system", "messages"] as Layer[],
};
const model = (overrides: Partial<typeof kind> = {}) =>
  new BreakpointCacheModel({ ...kind, ...overrides });
const prompt = (tools: number, system: number, messages: number) =>
  buildPrompt({ tools, system, messages });

describe("BreakpointCacheModel", () => {
  it("S3: first request is a miss that writes the whole prompt", () => {
    const r = model().request({ prompt: prompt(1000, 500, 200), atMinute: 0 });
    expect(r).toMatchObject({
      cacheRead: 0,
      cacheWrite: 1700,
      uncachedInput: 0,
      outcome: "miss",
    });
  });

  it("S3: a grown conversation reads the old prefix and writes only the delta", () => {
    const m = model();
    m.request({ prompt: prompt(1000, 500, 200), atMinute: 0 });
    const r = m.request({ prompt: prompt(1000, 500, 900), atMinute: 1 });
    expect(r).toMatchObject({
      cacheRead: 1700,
      cacheWrite: 700,
      uncachedInput: 0,
      outcome: "hit",
    });
  });

  it("S3: invalidating from a layer keeps only the prefix before it", () => {
    const m = model();
    m.request({ prompt: prompt(1000, 500, 200), atMinute: 0 });
    const r = m.request({
      prompt: prompt(1000, 500, 300),
      atMinute: 1,
      invalidatedFrom: "messages",
    });
    expect(r).toMatchObject({
      cacheRead: 1500,
      cacheWrite: 300,
      outcome: "partial",
    });
  });

  it("S3: invalidating from tools reads nothing", () => {
    const m = model();
    m.request({ prompt: prompt(1000, 500, 200), atMinute: 0 });
    const r = m.request({
      prompt: prompt(1100, 500, 200),
      atMinute: 1,
      invalidatedFrom: "tools",
    });
    expect(r).toMatchObject({
      cacheRead: 0,
      cacheWrite: 1800,
      outcome: "miss",
    });
  });

  it("S15: a shared prefix shorter than the cache keeps only that prefix", () => {
    const m = model();
    m.request({ prompt: prompt(1000, 500, 2000), atMinute: 0 });
    const r = m.request({
      prompt: prompt(1000, 500, 900),
      atMinute: 1,
      sharedPrefixTokens: 1900,
    });
    expect(r).toMatchObject({
      cacheRead: 1900,
      cacheWrite: 500,
      outcome: "partial",
    });
  });

  it("S4: TTL counts from the last request and a hit refreshes it", () => {
    const m = model();
    m.request({ prompt: prompt(1000, 500, 200), atMinute: 0 });
    expect(
      m.request({ prompt: prompt(1000, 500, 300), atMinute: 4 }).outcome,
    ).toBe("hit");
    expect(
      m.request({ prompt: prompt(1000, 500, 400), atMinute: 8 }).outcome,
    ).toBe("hit");
    const expired = m.request({
      prompt: prompt(1000, 500, 500),
      atMinute: 13.5,
    });
    expect(expired).toMatchObject({ cacheRead: 0, outcome: "miss" });
  });

  it("S4: without refreshOnHit a hit does not extend the TTL", () => {
    const m = model({ refreshOnHit: false });
    m.request({ prompt: prompt(1000, 500, 200), atMinute: 0 });
    m.request({ prompt: prompt(1000, 500, 300), atMinute: 4 });
    expect(
      m.request({ prompt: prompt(1000, 500, 400), atMinute: 6 }).outcome,
    ).toBe("miss");
  });

  it("S5: an extended-TTL write is reported separately and lives longer", () => {
    const m = model();
    const first = m.request({
      prompt: prompt(1000, 500, 200),
      atMinute: 0,
      extendedTtl: true,
    });
    expect(first).toMatchObject({ cacheWrite: 0, extendedCacheWrite: 1700 });
    expect(
      m.request({
        prompt: prompt(1000, 500, 200),
        atMinute: 50,
        extendedTtl: true,
      }).outcome,
    ).toBe("hit");
  });

  it("S6: below the minimum cacheable length nothing is cached", () => {
    const m = model();
    const first = m.request({ prompt: prompt(300, 200, 100), atMinute: 0 });
    expect(first).toMatchObject({
      cacheRead: 0,
      cacheWrite: 0,
      uncachedInput: 600,
    });
    const second = m.request({ prompt: prompt(300, 200, 150), atMinute: 1 });
    expect(second.cacheRead).toBe(0);
  });

  it("S6: a layer prefix under the minimum is skipped, a later breakpoint still caches", () => {
    const r = model().request({ prompt: prompt(300, 200, 900), atMinute: 0 });
    expect(r.cacheWrite).toBe(1400);
  });

  it("S2: read + write + uncached always equals the prompt, for random histories", () => {
    const step = fc.record({
      tools: fc.integer({ min: 0, max: 5000 }),
      system: fc.integer({ min: 0, max: 5000 }),
      messages: fc.integer({ min: 0, max: 50_000 }),
      gap: fc.double({ min: 0, max: 90, noNaN: true }),
      invalidatedFrom: fc.option(
        fc.constantFrom("tools", "system", "messages"),
        {
          nil: undefined,
        },
      ),
      extendedTtl: fc.boolean(),
    });
    fc.assert(
      fc.property(fc.array(step, { minLength: 1, maxLength: 12 }), (steps) => {
        const m = model();
        let now = 0;
        for (const s of steps) {
          now += s.gap;
          const p = prompt(s.tools, s.system, s.messages);
          const r = m.request({
            prompt: p,
            atMinute: now,
            invalidatedFrom: s.invalidatedFrom,
            extendedTtl: s.extendedTtl,
          });
          expect(
            r.cacheRead + r.cacheWrite + r.extendedCacheWrite + r.uncachedInput,
          ).toBe(p.totalTokens);
          expect(r.cacheRead).toBeLessThanOrEqual(p.totalTokens);
        }
      }),
    );
  });
});
