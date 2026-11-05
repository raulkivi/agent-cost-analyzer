import { describe, expect, it } from "vitest";
import { BundledPriceBookSource, defaultPriceBookDir } from "./bundled-price-book-source.js";
import { PriceBook } from "./price-book.js";

// Step 15.5 data, D8 (revised): GitHub Copilot's price history from
// 2026-10-01, as github/docs' data/tables/copilot/models-and-pricing.yml
// proves it. The table at 7f63f3a (2026-09-29) was unchanged until 9c7da1a
// (2026-10-02), so what it lists was in force on 2026-10-01; later changes
// start on the date of the commit that made them.
const source = new BundledPriceBookSource(defaultPriceBookDir());
const book = new PriceBook(source);
const { versions, sources } = source.load();
const copilot = versions.filter((version) => version.channel === "github-copilot");

function versionAt(modelId: string, at: string) {
  const lookup = book.priceFor("github-copilot", modelId, at);
  return lookup.known ? lookup.version : undefined;
}

// Models added to the table after 2026-10-01, with the commit date that added them.
const ADDED = { "claude-haiku-5.5": "2026-10-07", "gemini-4-argon": "2026-10-13", "gpt-6.1-terra": "2026-10-26" } as const;

// Models in the table on 2026-10-01 that GitHub removed later in October,
// with the date of the commit that removed them (9c7da1a, 4dd188c). They
// stay in the book so October turns on them are priced (owner, 2026-11-05).
const REMOVED = {
  "claude-opus-4.7": "2026-10-02",
  "gemini-3.5-flash": "2026-10-02",
  "gemini-3.6-flash": "2026-10-02",
  "kimi-k2.7-code": "2026-10-02",
  "gpt-5-mini": "2026-10-19",
  "gpt-5.4": "2026-10-19",
  "gpt-5.4-mini": "2026-10-19",
  "gpt-5.5": "2026-10-19",
  "gemini-3.7-flash": "2026-10-19",
} as const;

describe("GitHub Copilot price history (step 15.5, D8 from 2026-10-01)", () => {
  it("prices every model listed on 2026-10-01 from that day", () => {
    const models = [...new Set(copilot.map((version) => version.modelId))];
    expect(models.length).toBe(38);
    for (const modelId of models.filter((id) => !(id in ADDED))) {
      expect(versionAt(modelId, "2026-10-01T00:00:00Z")?.effectiveFrom, modelId).toBe("2026-10-01");
      expect(book.priceFor("github-copilot", modelId, "2026-09-30T23:59:59Z").known, modelId).toBe(false);
    }
    expect(versionAt("gpt-5.6-sol", "2026-10-01")).toMatchObject({
      id: "github-copilot:gpt-5.6-sol:2026-10-01",
      tiers: [
        { maxInputTokens: 272000, inputUsdPerM: 4, cachedInputUsdPerM: 0.4, cacheWriteUsdPerM: 5, outputUsdPerM: 20 },
        { inputUsdPerM: 8, cachedInputUsdPerM: 0.8, cacheWriteUsdPerM: 10, outputUsdPerM: 30 },
      ],
    });
  });

  it("starts each model added later on the day its row was added", () => {
    for (const [modelId, added] of Object.entries(ADDED)) {
      const previousDay = new Date(Date.parse(`${added}T00:00:00Z`) - 1).toISOString();
      expect(book.priceFor("github-copilot", modelId, previousDay).known, modelId).toBe(false);
      expect(versionAt(modelId, `${added}T00:00:00Z`)?.id, modelId).toBe(`github-copilot:${modelId}:${added}`);
    }
  });

  it("halves Claude Sonnet 5.5's cached input price on 2026-10-07 (eb975b9)", () => {
    expect(versionAt("claude-sonnet-5.5", "2026-10-06T23:59:59Z")).toMatchObject({
      id: "github-copilot:claude-sonnet-5.5:2026-10-01",
      effectiveTo: "2026-10-07",
      tiers: [{ inputUsdPerM: 2, cachedInputUsdPerM: 0.2, cacheWriteUsdPerM: 2.5, outputUsdPerM: 10 }],
    });
    expect(versionAt("claude-sonnet-5.5", "2026-10-07T00:00:00Z")).toMatchObject({
      id: "github-copilot:claude-sonnet-5.5:2026-10-07",
      tiers: [{ inputUsdPerM: 2, cachedInputUsdPerM: 0.1, cacheWriteUsdPerM: 2.5, outputUsdPerM: 10 }],
    });
    expect(book.newestVersion("github-copilot", "claude-sonnet-5.5")?.id).toBe("github-copilot:claude-sonnet-5.5:2026-10-07");
  });

  it("ends each model GitHub removed in October on the day of the commit that removed it", () => {
    for (const [modelId, removedOn] of Object.entries(REMOVED)) {
      const version = versionAt(modelId, "2026-10-01T12:00:00Z");
      expect(version?.effectiveTo, modelId).toBe(removedOn);
      expect(book.priceFor("github-copilot", modelId, `${removedOn}T00:00:00Z`), modelId).toEqual({
        known: false,
        reason: `no price for ${modelId} on github-copilot from ${removedOn}`,
      });
    }
    expect(versionAt("gpt-5.5", "2026-10-18")).toMatchObject({
      tiers: [
        { maxInputTokens: 272000, inputUsdPerM: 5, cachedInputUsdPerM: 0.5, cacheWriteUsdPerM: null, outputUsdPerM: 30 },
        { inputUsdPerM: 10, cachedInputUsdPerM: 1, cacheWriteUsdPerM: null, outputUsdPerM: 45 },
      ],
    });
    expect(versionAt("claude-opus-4.7", "2026-10-01")).toMatchObject({
      tiers: [{ inputUsdPerM: 5, cachedInputUsdPerM: 0.5, cacheWriteUsdPerM: 6.25, extendedCacheWriteUsdPerM: 10, outputUsdPerM: 25 }],
    });
    expect(versionAt("gemini-3.6-flash", "2026-10-01")).toMatchObject({ kind: "promo", promoEndsAt: "2026-12-31", effectiveTo: "2026-10-02" });
  });

  it("keeps Gemini 3.8 Flash's promotion in force from 2026-10-01 to its stated end", () => {
    expect(versionAt("gemini-3.8-flash", "2026-10-01")).toMatchObject({ kind: "promo", promoEndsAt: "2026-12-31", effectiveTo: "2027-01-01" });
    expect(versionAt("gemini-4-argon", "2026-10-13")).toMatchObject({ kind: "promo", promoEndsAt: "2026-12-01", effectiveTo: "2026-12-01" });
  });

  it("has one version per model except where a price changed", () => {
    const counts = new Map<string, number>();
    for (const version of copilot) counts.set(version.modelId, (counts.get(version.modelId) ?? 0) + 1);
    expect([...counts].filter(([, count]) => count > 1)).toEqual([["claude-sonnet-5.5", 2]]);
  });

  it("cites, first, the price table pinned at the github/docs commit that proves each version's start", () => {
    const byId = new Map(sources.map((cited) => [cited.id, cited]));
    const proving: Record<string, string> = {
      "2026-10-01": "7f63f3a5dce5e0caffcc9c4326cdac982c7adc73",
      "2026-10-07": "eb975b9c497b7f4bd04a020afe730565a1e33921",
      "2026-10-13": "924579599358cb4235d5d40975ae6d905bc24554",
      "2026-10-26": "cc0c29a040c251c48ed65198f108a484c33406fa",
    };
    for (const version of copilot) {
      const first = byId.get(version.sourceIds[0]!);
      expect(first?.url, version.id).toBe(
        `https://github.com/github/docs/blob/${proving[version.effectiveFrom]}/data/tables/copilot/models-and-pricing.yml`,
      );
      expect(first?.checkedAt, version.id).toBe("2026-11-05");
      expect(first?.quote ?? "", version.id).not.toBe("");
      // A version still in force also cites the table as of its last commit (cc0c29a).
      if (!(version.modelId in REMOVED) && (version.effectiveTo === undefined || version.kind === "promo")) expect(version.sourceIds, version.id).toContain("gh-pricing-table");
    }
  });
});
