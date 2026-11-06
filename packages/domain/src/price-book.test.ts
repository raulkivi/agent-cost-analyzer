import { describe, expect, it } from "vitest";
import {
  findPriceVersionConflicts,
  priceBookChannelFileSchema,
  priceBookEntrySchema,
  priceBookListingSchema,
  priceLookupSchema,
  priceVersionSchema,
  type PriceVersion,
} from "./price-book.js";

const tier = { inputUsdPerM: 3, cachedInputUsdPerM: 0.3, cacheWriteUsdPerM: 3.75, outputUsdPerM: 15 };

function version(overrides: Partial<PriceVersion> = {}): PriceVersion {
  return {
    id: "github-copilot:claude-sonnet-5.5:2026-10-26",
    channel: "github-copilot",
    modelId: "claude-sonnet-5.5",
    currency: "USD",
    effectiveFrom: "2026-10-26",
    tiers: [tier],
    kind: "list",
    sourceIds: ["gh-pricing-table"],
    ...overrides,
  };
}

describe("priceVersionSchema", () => {
  it("accepts the plan's §6.1 shape", () => {
    expect(priceVersionSchema.parse(version({ effectiveTo: "2026-12-01", note: "n" }))).toMatchObject({ effectiveTo: "2026-12-01" });
  });

  it("defaults sourceIds to an empty list (a user contract may cite none)", () => {
    const withoutSources: Partial<PriceVersion> = version({ kind: "contract", channel: "acme-reseller" });
    delete withoutSources.sourceIds;
    expect(priceVersionSchema.parse(withoutSources).sourceIds).toEqual([]);
  });

  it("rejects dates that aren't ISO calendar dates", () => {
    expect(priceVersionSchema.safeParse(version({ effectiveFrom: "2026-13-01" })).success).toBe(false);
    expect(priceVersionSchema.safeParse(version({ effectiveFrom: "26 Oct 2026" })).success).toBe(false);
  });

  it("rejects an empty or backwards range: effectiveTo is exclusive and must be after effectiveFrom", () => {
    expect(priceVersionSchema.safeParse(version({ effectiveTo: "2026-10-26" })).success).toBe(false);
    expect(priceVersionSchema.safeParse(version({ effectiveTo: "2026-10-01" })).success).toBe(false);
  });

  it("needs a tier and orders tiers by ascending threshold, the last without one", () => {
    expect(priceVersionSchema.safeParse(version({ tiers: [] })).success).toBe(false);
    expect(
      priceVersionSchema.safeParse(version({ tiers: [{ ...tier, maxInputTokens: 200_000 }, tier] })).success,
    ).toBe(true);
    expect(priceVersionSchema.safeParse(version({ tiers: [tier, { ...tier, maxInputTokens: 200_000 }] })).success).toBe(false);
    expect(
      priceVersionSchema.safeParse(version({ tiers: [{ ...tier, maxInputTokens: 300_000 }, { ...tier, maxInputTokens: 200_000 }, tier] }))
        .success,
    ).toBe(false);
  });

  it("keeps promoEndsAt to promo versions and requires it there", () => {
    expect(priceVersionSchema.safeParse(version({ kind: "promo", promoEndsAt: "2026-12-01" })).success).toBe(true);
    expect(priceVersionSchema.safeParse(version({ kind: "promo" })).success).toBe(false);
    expect(priceVersionSchema.safeParse(version({ promoEndsAt: "2026-12-01" })).success).toBe(false);
  });

  it("allows a scope (one project or one repository) on contract versions only", () => {
    expect(priceVersionSchema.safeParse(version({ kind: "contract", scope: { projectId: "acme" } })).success).toBe(true);
    expect(priceVersionSchema.safeParse(version({ kind: "contract", scope: { repository: "github.com/a/b" } })).success).toBe(true);
    expect(priceVersionSchema.safeParse(version({ scope: { projectId: "acme" } })).success).toBe(false);
    expect(
      priceVersionSchema.safeParse(version({ kind: "contract", scope: { projectId: "a", repository: "b" } as never })).success,
    ).toBe(false);
  });

  it("is USD only: PriceTier's fields are USD per 1M tokens", () => {
    expect(priceVersionSchema.safeParse({ ...version(), currency: "EUR" }).success).toBe(false);
  });
});

describe("priceBookEntrySchema / priceLookupSchema / listing", () => {
  it("marks each version's origin", () => {
    expect(priceBookEntrySchema.parse({ ...version(), origin: "bundled" }).origin).toBe("bundled");
    expect(priceBookEntrySchema.safeParse({ ...version(), origin: "elsewhere" }).success).toBe(false);
    // The entry keeps the version's own checks.
    expect(priceBookEntrySchema.safeParse({ ...version({ effectiveTo: "2026-01-01" }), origin: "user" }).success).toBe(false);
  });

  it("is known with a version, or unknown with a reason (constraint 6: never 0)", () => {
    expect(priceLookupSchema.parse({ known: true, version: { ...version(), origin: "bundled" } }).known).toBe(true);
    expect(priceLookupSchema.safeParse({ known: false, reason: "" }).success).toBe(false);
    expect(priceLookupSchema.parse({ known: false, reason: "no price" })).toEqual({ known: false, reason: "no price" });
  });

  it("lists versions with their sources, gaps, unknowns and problems", () => {
    const listing = priceBookListingSchema.parse({
      channels: ["github-copilot"],
      versions: [{ ...version(), origin: "bundled" }],
      sources: [{ id: "gh-pricing-table", title: "t", url: "https://example.com", checkedAt: "2026-11-05" }],
      gaps: [],
      unknown: [{ channel: "openai-api", modelId: "gpt-x", reason: "no price book for channel openai-api" }],
      problems: [{ path: "channels.priceVersions[0]", message: "overlaps" }],
    });
    expect(listing.versions).toHaveLength(1);
  });
});

describe("priceBookChannelFileSchema", () => {
  it("holds one channel's sources and versions", () => {
    const parsed = priceBookChannelFileSchema.parse({
      channel: "github-copilot",
      sources: [{ id: "gh-pricing-table", title: "t", url: "https://example.com", checkedAt: "2026-11-05" }],
      versions: [version()],
    });
    expect(parsed.versions).toHaveLength(1);
  });
});

describe("findPriceVersionConflicts", () => {
  it("finds no conflict in one open-ended version", () => {
    expect(findPriceVersionConflicts([version()])).toEqual({ overlaps: [], gaps: [] });
  });

  it("rejects two versions of one model on one channel that overlap", () => {
    const first = version({ id: "a", effectiveFrom: "2026-01-01", effectiveTo: "2026-06-01" });
    const second = version({ id: "b", effectiveFrom: "2026-05-01" });
    expect(findPriceVersionConflicts([second, first]).overlaps).toEqual([{ first: "a", second: "b" }]);
  });

  it("treats an open-ended version as overlapping every later one", () => {
    const first = version({ id: "a", effectiveFrom: "2026-01-01" });
    const second = version({ id: "b", effectiveFrom: "2026-09-01" });
    expect(findPriceVersionConflicts([first, second]).overlaps).toEqual([{ first: "a", second: "b" }]);
  });

  it("accepts versions that meet exactly at a boundary ([from, to))", () => {
    const first = version({ id: "a", effectiveFrom: "2026-01-01", effectiveTo: "2026-09-01" });
    const second = version({ id: "b", effectiveFrom: "2026-09-01" });
    expect(findPriceVersionConflicts([first, second])).toEqual({ overlaps: [], gaps: [] });
  });

  it("flags a gap between versions without rejecting it", () => {
    const first = version({ id: "a", effectiveFrom: "2026-01-01", effectiveTo: "2026-03-01" });
    const second = version({ id: "b", effectiveFrom: "2026-04-01" });
    expect(findPriceVersionConflicts([first, second])).toEqual({
      overlaps: [],
      gaps: [{ channel: "github-copilot", modelId: "claude-sonnet-5.5", from: "2026-03-01", to: "2026-04-01" }],
    });
  });

  it("keeps models, channels and precedence classes apart", () => {
    const list = version({ id: "a" });
    const otherModel = version({ id: "b", modelId: "claude-opus-5.5" });
    const otherChannel = version({ id: "c", channel: "anthropic-api" });
    const promo = version({ id: "d", kind: "promo", promoEndsAt: "2026-12-01", effectiveFrom: "2026-11-01" });
    const contract = version({ id: "e", kind: "contract" });
    const scoped = version({ id: "f", kind: "contract", scope: { projectId: "acme" } });
    // promo and list are one class (both are the vendor's own price), so d overlaps a.
    expect(findPriceVersionConflicts([list, otherModel, otherChannel, promo, contract, scoped]).overlaps).toEqual([
      { first: "a", second: "d" },
    ]);
  });

  it("rejects overlapping contracts with the same scope", () => {
    const first = version({ id: "a", kind: "contract", scope: { repository: "github.com/a/b" } });
    const second = version({ id: "b", kind: "contract", scope: { repository: "github.com/a/b" }, effectiveFrom: "2026-11-01" });
    expect(findPriceVersionConflicts([first, second]).overlaps).toEqual([{ first: "a", second: "b" }]);
  });
});
