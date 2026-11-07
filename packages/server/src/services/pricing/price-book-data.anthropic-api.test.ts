// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { BundledPriceBookSource, defaultPriceBookDir } from "./bundled-price-book-source.js";
import { PriceBook } from "./price-book.js";

// Phase 15 step 15.5 data: the Anthropic API's own list prices
// (fixtures/price-book/anthropic-api.json), from D8's 2026-10-01 to the
// snapshot date, each version citing Anthropic's pricing page, release
// notes or announcements. cacheWriteUsdPerM is the 5-minute write and
// extendedCacheWriteUsdPerM the 1-hour write, as in github-copilot.json.
const source = new BundledPriceBookSource(defaultPriceBookDir());
const book = new PriceBook(source);
const { sources } = source.load();
const versions = source.load().versions.filter((version) => version.channel === "anthropic-api");

function tiersAt(modelId: string, at: string) {
  const lookup = book.priceFor("anthropic-api", modelId, at);
  if (!lookup.known) throw new Error(lookup.reason);
  return lookup.version.tiers;
}

describe("anthropic-api price book data", () => {
  it("loads through BundledPriceBookSource as its own channel", () => {
    expect(book.list({}).channels).toContain("anthropic-api");
    expect(versions.length).toBeGreaterThan(0);
  });

  it("cites only anthropic-api- sources, each a dated https page", () => {
    const byId = new Map(sources.map((cited) => [cited.id, cited]));
    for (const version of versions) {
      expect(version.sourceIds.length, version.id).toBeGreaterThan(0);
      for (const id of version.sourceIds) {
        expect(id, version.id).toMatch(/^anthropic-api-/);
        expect(byId.get(id)?.url, `${version.id} -> ${id}`).toMatch(/^https:\/\/(platform\.claude\.com|www\.anthropic\.com)\//);
        expect(byId.get(id)?.checkedAt, `${version.id} -> ${id}`).toBe("2026-11-05");
        expect(byId.get(id)?.quote, `${version.id} -> ${id}`).toBeTruthy();
      }
    }
  });

  it("names every version <channel>:<modelId>:<effectiveFrom> and starts no earlier than 2026-10-01", () => {
    for (const version of versions) {
      expect(version.id).toBe(`anthropic-api:${version.modelId}:${version.effectiveFrom}`);
      expect(version.effectiveFrom >= "2026-10-01", version.id).toBe(true);
      expect(version.kind, version.id).toBe("list");
    }
  });

  it("has no gaps on the channel", () => {
    expect(book.list({ channel: "anthropic-api" }).gaps).toEqual([]);
  });

  it("prices cache writes at Anthropic's multipliers: 5-minute 1.25x and 1-hour 2x the input price", () => {
    for (const version of versions) {
      for (const tier of version.tiers) {
        expect(tier.cacheWriteUsdPerM, version.id).toBeCloseTo(tier.inputUsdPerM * 1.25, 10);
        expect(tier.extendedCacheWriteUsdPerM, version.id).toBeCloseTo(tier.inputUsdPerM * 2, 10);
      }
    }
  });

  it("prices Claude Sonnet 5.5 cache reads at $0.20 until the 2026-10-07 cut, then $0.10", () => {
    expect(tiersAt("claude-sonnet-5.5", "2026-10-01T00:00:00Z")).toEqual([
      { inputUsdPerM: 2, cachedInputUsdPerM: 0.2, cacheWriteUsdPerM: 2.5, extendedCacheWriteUsdPerM: 4, outputUsdPerM: 10 },
    ]);
    expect(tiersAt("claude-sonnet-5.5", "2026-10-06T23:59:59Z")[0]?.cachedInputUsdPerM).toBe(0.2);
    expect(tiersAt("claude-sonnet-5.5", "2026-10-07T00:00:00Z")[0]?.cachedInputUsdPerM).toBe(0.1);
    expect(tiersAt("claude-sonnet-5.5", "2026-11-05T10:00:00Z")).toEqual([
      { inputUsdPerM: 2, cachedInputUsdPerM: 0.1, cacheWriteUsdPerM: 2.5, extendedCacheWriteUsdPerM: 4, outputUsdPerM: 10 },
    ]);
  });

  it("prices Claude Opus 5.5 from 2026-10-01 and leaves earlier turns unknown", () => {
    expect(tiersAt("claude-opus-5.5", "2026-10-01T09:00:00Z")).toEqual([
      { inputUsdPerM: 4, cachedInputUsdPerM: 0.2, cacheWriteUsdPerM: 5, extendedCacheWriteUsdPerM: 8, outputUsdPerM: 20 },
    ]);
    expect(book.priceFor("anthropic-api", "claude-opus-5.5", "2026-09-30T12:00:00Z").known).toBe(false);
  });

  it("prices Claude Haiku 5.5 by prompt length from its 2026-10-07 launch", () => {
    expect(tiersAt("claude-haiku-5.5", "2026-10-07T12:00:00Z")).toEqual([
      { maxInputTokens: 100000, inputUsdPerM: 0.1, cachedInputUsdPerM: 0.01, cacheWriteUsdPerM: 0.125, extendedCacheWriteUsdPerM: 0.2, outputUsdPerM: 0.5 },
      { inputUsdPerM: 0.5, cachedInputUsdPerM: 0.05, cacheWriteUsdPerM: 0.625, extendedCacheWriteUsdPerM: 1, outputUsdPerM: 2.5 },
    ]);
    expect(book.priceFor("anthropic-api", "claude-haiku-5.5", "2026-10-06T12:00:00Z")).toEqual({
      known: false,
      reason: "no price for claude-haiku-5.5 on anthropic-api before 2026-10-07",
    });
  });

  it("prices Claude Fable 5.1's discounted cache reads and fast mode on Claude Opus 5.5", () => {
    expect(tiersAt("claude-fable-5.1", "2026-10-15T00:00:00Z")[0]).toMatchObject({ inputUsdPerM: 10, cachedInputUsdPerM: 0.25, outputUsdPerM: 50 });
    expect(tiersAt("claude-opus-5.5-fast", "2026-10-15T00:00:00Z")[0]).toMatchObject({ inputUsdPerM: 8, outputUsdPerM: 40 });
  });
});
