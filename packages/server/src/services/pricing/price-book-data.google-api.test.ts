import { describe, expect, it } from "vitest";
import { BundledPriceBookSource, defaultPriceBookDir } from "./bundled-price-book-source.js";
import { PriceBook } from "./price-book.js";

// Phase 15 step 15.5 data: the Gemini Developer API's own paid-tier
// (Standard) prices (fixtures/price-book/google-api.json), from D8's
// 2026-10-01 to the snapshot date, each version citing ai.google.dev's
// pricing page, model guides or release notes. Gemini has no per-token
// cache write price (explicit caches bill storage per hour, which the
// tiers can't hold), so cacheWriteUsdPerM is null throughout.
const source = new BundledPriceBookSource(defaultPriceBookDir());
const book = new PriceBook(source);
const { sources } = source.load();
const versions = source.load().versions.filter((version) => version.channel === "google-api");

function lookup(modelId: string, at: string) {
  const found = book.priceFor("google-api", modelId, at);
  if (!found.known) throw new Error(found.reason);
  return found.version;
}

describe("google-api price book data", () => {
  it("loads through BundledPriceBookSource as its own channel", () => {
    expect(book.list({}).channels).toContain("google-api");
    expect(versions.length).toBeGreaterThan(0);
  });

  it("cites only google-api- sources, each a dated ai.google.dev page with a quote", () => {
    const byId = new Map(sources.map((cited) => [cited.id, cited]));
    for (const version of versions) {
      expect(version.sourceIds.length, version.id).toBeGreaterThan(0);
      for (const id of version.sourceIds) {
        expect(id, version.id).toMatch(/^google-api-/);
        expect(byId.get(id)?.url, `${version.id} -> ${id}`).toMatch(/^https:\/\/ai\.google\.dev\//);
        expect(byId.get(id)?.checkedAt, `${version.id} -> ${id}`).toBe("2026-11-06");
        expect(byId.get(id)?.quote, `${version.id} -> ${id}`).toBeTruthy();
      }
    }
  });

  it("names every version <channel>:<modelId>:<effectiveFrom> and starts no earlier than 2026-10-01", () => {
    for (const version of versions) {
      expect(version.id).toBe(`google-api:${version.modelId}:${version.effectiveFrom}`);
      expect(version.effectiveFrom >= "2026-10-01", version.id).toBe(true);
      expect(version.note, version.id).toBeTruthy();
    }
  });

  it("has no gaps on the channel", () => {
    expect(book.list({ channel: "google-api" }).gaps).toEqual([]);
  });

  it("has no per-token cache write price", () => {
    for (const version of versions) {
      for (const tier of version.tiers) expect(tier.cacheWriteUsdPerM, version.id).toBeNull();
    }
  });

  it("prices Gemini 3.8 Flash at its introductory price from 2026-10-01 through 2026-12-31, then the standard price", () => {
    const intro = lookup("gemini-3.8-flash", "2026-10-01T00:00:00Z");
    expect(intro.kind).toBe("promo");
    expect(intro.promoEndsAt).toBe("2026-12-31");
    expect(intro.tiers).toEqual([{ inputUsdPerM: 0.75, cachedInputUsdPerM: 0.075, cacheWriteUsdPerM: null, outputUsdPerM: 3.75 }]);
    expect(lookup("gemini-3.8-flash", "2026-12-31T23:59:59Z").id).toBe(intro.id);
    expect(lookup("gemini-3.8-flash", "2027-01-01T00:00:00Z").tiers).toEqual([
      { inputUsdPerM: 1.5, cachedInputUsdPerM: 0.15, cacheWriteUsdPerM: null, outputUsdPerM: 7.5 },
    ]);
    expect(book.priceFor("google-api", "gemini-3.8-flash", "2026-09-30T12:00:00Z")).toEqual({
      known: false,
      reason: "no price for gemini-3.8-flash on google-api before 2026-10-01",
    });
  });

  it("prices Gemini 4 Argon from its 2026-10-13 launch, introductory through 2026-11-30", () => {
    expect(book.priceFor("google-api", "gemini-4-argon", "2026-10-12T12:00:00Z").known).toBe(false);
    const intro = lookup("gemini-4-argon", "2026-10-13T00:00:00Z");
    expect(intro).toMatchObject({ kind: "promo", promoEndsAt: "2026-11-30", effectiveTo: "2026-12-01" });
    expect(intro.tiers).toEqual([{ inputUsdPerM: 2, cachedInputUsdPerM: 0.1, cacheWriteUsdPerM: null, outputUsdPerM: 10 }]);
    expect(lookup("gemini-4-argon", "2026-12-01T00:00:00Z").tiers).toEqual([
      { inputUsdPerM: 4, cachedInputUsdPerM: 0.2, cacheWriteUsdPerM: null, outputUsdPerM: 20 },
    ]);
  });

  it("prices Gemini 3.1 Pro Preview by prompt length, with a tier above 200,000 tokens", () => {
    expect(lookup("gemini-3.1-pro-preview", "2026-11-06T12:00:00Z").tiers).toEqual([
      { maxInputTokens: 200000, inputUsdPerM: 2, cachedInputUsdPerM: 0.2, cacheWriteUsdPerM: null, outputUsdPerM: 12 },
      { inputUsdPerM: 4, cachedInputUsdPerM: 0.4, cacheWriteUsdPerM: null, outputUsdPerM: 18 },
    ]);
  });

  it("bills gemini-2.5-pro at Gemini 3.8 Flash rates once it is routed there on 2026-12-01", () => {
    expect(lookup("gemini-2.5-pro", "2026-11-30T12:00:00Z").tiers).toHaveLength(2);
    expect(lookup("gemini-2.5-pro", "2026-12-01T00:00:00Z").tiers).toEqual(lookup("gemini-3.8-flash", "2026-12-01T00:00:00Z").tiers);
    expect(lookup("gemini-2.5-pro", "2027-01-01T00:00:00Z").tiers).toEqual(lookup("gemini-3.8-flash", "2027-01-01T00:00:00Z").tiers);
  });
});
