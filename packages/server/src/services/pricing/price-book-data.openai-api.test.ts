import { describe, expect, it } from "vitest";
import { BundledPriceBookSource, defaultPriceBookDir } from "./bundled-price-book-source.js";
import { PriceBook } from "./price-book.js";

// Phase 15 step 15.5 data: the OpenAI API's own standard-tier list prices
// (fixtures/price-book/openai-api.json), from D8's 2026-10-01 to the
// snapshot date, each version citing OpenAI's pricing page, model pages,
// prompt-caching guide or dated changelog. cacheWriteUsdPerM is the
// default 30-minute write and extendedCacheWriteUsdPerM the 12-hour write
// (offered from 2026-10-20); the long-context tier covers prompts over
// 272K input tokens. Batch, Flex, Fast and Ultrafast are not modelled.
const source = new BundledPriceBookSource(defaultPriceBookDir());
const book = new PriceBook(source);
const { sources } = source.load();
const versions = source.load().versions.filter((version) => version.channel === "openai-api");

function lookupAt(modelId: string, at: string) {
  const lookup = book.priceFor("openai-api", modelId, at);
  if (!lookup.known) throw new Error(lookup.reason);
  return lookup.version;
}

describe("openai-api price book data", () => {
  it("loads through BundledPriceBookSource as its own channel", () => {
    expect(book.list({}).channels).toContain("openai-api");
    expect(versions.length).toBeGreaterThan(0);
  });

  it("cites only openai-api- sources, each an OpenAI page with a quote checked on 2026-11-06", () => {
    const byId = new Map(sources.map((cited) => [cited.id, cited]));
    for (const version of versions) {
      expect(version.sourceIds.length, version.id).toBeGreaterThan(0);
      for (const id of version.sourceIds) {
        expect(id, version.id).toMatch(/^openai-api-/);
        expect(byId.get(id)?.url, `${version.id} -> ${id}`).toMatch(/^https:\/\/(developers|platform)\.openai\.com\//);
        expect(byId.get(id)?.checkedAt, `${version.id} -> ${id}`).toBe("2026-11-06");
        expect(byId.get(id)?.quote, `${version.id} -> ${id}`).toBeTruthy();
      }
    }
  });

  it("names every version <channel>:<modelId>:<effectiveFrom> and starts no earlier than 2026-10-01", () => {
    for (const version of versions) {
      expect(version.id).toBe(`openai-api:${version.modelId}:${version.effectiveFrom}`);
      expect(version.effectiveFrom >= "2026-10-01", version.id).toBe(true);
      expect(["list", "promo"], version.id).toContain(version.kind);
      expect(version.note, version.id).toBeTruthy();
    }
  });

  it("has no gaps on the channel", () => {
    expect(book.list({ channel: "openai-api" }).gaps).toEqual([]);
  });

  it("prices cache writes at OpenAI's multipliers: 30-minute 1.25x and 12-hour 2.5x the input price, where charged", () => {
    for (const version of versions) {
      for (const tier of version.tiers) {
        if (tier.cacheWriteUsdPerM === null) {
          expect(tier.extendedCacheWriteUsdPerM, version.id).toBeUndefined();
          continue;
        }
        expect(tier.cacheWriteUsdPerM, version.id).toBeCloseTo(tier.inputUsdPerM * 1.25, 10);
        if (version.effectiveFrom < "2026-10-20") {
          expect(tier.extendedCacheWriteUsdPerM, version.id).toBeUndefined();
        } else {
          expect(tier.extendedCacheWriteUsdPerM, version.id).toBeCloseTo(tier.inputUsdPerM * 2.5, 10);
        }
      }
    }
  });

  it("prices GPT-6.1 Sol from 2026-10-01 with a long-context tier above 272K input tokens, adding the 12-hour write on 2026-10-20", () => {
    expect(lookupAt("gpt-6.1-sol", "2026-10-01T00:00:00Z").tiers).toEqual([
      { maxInputTokens: 272000, inputUsdPerM: 2, cachedInputUsdPerM: 0.1, cacheWriteUsdPerM: 2.5, outputUsdPerM: 10 },
      { inputUsdPerM: 4, cachedInputUsdPerM: 0.2, cacheWriteUsdPerM: 5, outputUsdPerM: 15 },
    ]);
    expect(lookupAt("gpt-6.1-sol", "2026-10-19T23:59:59Z").tiers[0]?.extendedCacheWriteUsdPerM).toBeUndefined();
    expect(lookupAt("gpt-6.1-sol", "2026-11-06T10:00:00Z").tiers).toEqual([
      { maxInputTokens: 272000, inputUsdPerM: 2, cachedInputUsdPerM: 0.1, cacheWriteUsdPerM: 2.5, extendedCacheWriteUsdPerM: 5, outputUsdPerM: 10 },
      { inputUsdPerM: 4, cachedInputUsdPerM: 0.2, cacheWriteUsdPerM: 5, extendedCacheWriteUsdPerM: 10, outputUsdPerM: 15 },
    ]);
  });

  it("prices GPT-6 Sol from 2026-10-01 and leaves earlier turns unknown", () => {
    expect(lookupAt("gpt-6-sol", "2026-10-01T09:00:00Z").tiers[0]).toEqual({
      maxInputTokens: 272000,
      inputUsdPerM: 2,
      cachedInputUsdPerM: 0.2,
      cacheWriteUsdPerM: 2.5,
      outputUsdPerM: 10,
    });
    expect(book.priceFor("openai-api", "gpt-6-sol", "2026-09-30T12:00:00Z")).toEqual({
      known: false,
      reason: "no price for gpt-6-sol on openai-api before 2026-10-01",
    });
  });

  it("prices GPT-5.6 Sol as a promotion ending 2026-11-30, with no price after it", () => {
    const version = lookupAt("gpt-5.6-sol", "2026-11-06T00:00:00Z");
    expect(version.kind).toBe("promo");
    expect(version.promoEndsAt).toBe("2026-11-30");
    expect(version.tiers[0]).toMatchObject({ inputUsdPerM: 4, cachedInputUsdPerM: 0.4, cacheWriteUsdPerM: 5, outputUsdPerM: 20 });
    expect(book.priceFor("openai-api", "gpt-5.6-sol", "2026-12-01T00:00:00Z").known).toBe(false);
  });

  it("charges no cache write on models before GPT-5.6", () => {
    expect(lookupAt("gpt-5.4", "2026-11-06T12:00:00Z").tiers).toEqual([
      { maxInputTokens: 272000, inputUsdPerM: 2.5, cachedInputUsdPerM: 0.25, cacheWriteUsdPerM: null, outputUsdPerM: 15 },
      { inputUsdPerM: 5, cachedInputUsdPerM: 0.5, cacheWriteUsdPerM: null, outputUsdPerM: 22.5 },
    ]);
    expect(lookupAt("gpt-5.3-codex", "2026-11-06T12:00:00Z").tiers).toEqual([
      { inputUsdPerM: 1.75, cachedInputUsdPerM: 0.175, cacheWriteUsdPerM: null, outputUsdPerM: 14 },
    ]);
  });

  it("prices GPT-6 Astra and GPT-6.1 Terra only from 2026-11-06, the first date an OpenAI source gives their price", () => {
    expect(lookupAt("gpt-6-astra", "2026-11-06T00:00:00Z").tiers[0]).toMatchObject({ inputUsdPerM: 10, cachedInputUsdPerM: 1, outputUsdPerM: 50 });
    expect(lookupAt("gpt-6.1-terra", "2026-11-06T00:00:00Z").tiers[0]).toMatchObject({ inputUsdPerM: 1, cachedInputUsdPerM: 0.05, outputUsdPerM: 5 });
    expect(book.priceFor("openai-api", "gpt-6.1-terra", "2026-11-05T23:59:59Z").known).toBe(false);
  });
});
