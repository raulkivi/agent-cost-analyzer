import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PriceBookEntry } from "@agent-cost-analyzer/domain";
import { BundledPriceBookSource } from "../../services/pricing/bundled-price-book-source.js";
import { PriceBook } from "../../services/pricing/price-book.js";
import { loadVendorProfiles } from "./loader.js";

// Phase 15 step 15.5 (plan §6.1): the vendor profiles take their current
// prices from the price book's newest github-copilot version, so prices
// live in one place.
const tier = { inputUsdPerM: 3, cachedInputUsdPerM: 0.3, cacheWriteUsdPerM: 3.75, outputUsdPerM: 15 };

function profileFile(model: Record<string, unknown>) {
  return {
    vendorId: "acme",
    displayName: "Acme",
    defaultModelId: "acme-big",
    caching: { kind: "best-effort", note: "n" },
    invalidation: [],
    models: [{ modelId: "acme-big", displayName: "Acme Big", vendorId: "acme", releaseStatus: "GA", sourceIds: ["doc"], ...model }],
    assumptions: [],
    sources: [{ id: "doc", title: "Doc", url: "https://example.com", checkedAt: "2026-11-05" }],
  };
}

function version(overrides: Partial<PriceBookEntry> = {}): PriceBookEntry {
  return {
    id: "github-copilot:acme-big:2026-10-26",
    channel: "github-copilot",
    modelId: "acme-big",
    currency: "USD",
    effectiveFrom: "2026-10-26",
    tiers: [tier],
    kind: "list",
    sourceIds: ["doc"],
    origin: "bundled",
    ...overrides,
  };
}

const bookOf = (versions: PriceBookEntry[]) => new PriceBook({ load: () => ({ versions, sources: [], problems: [] }) });

describe("loadVendorProfiles with a price book", () => {
  let dir: string;
  const write = (content: unknown): void => writeFileSync(path.join(dir, "acme.json"), JSON.stringify(content));

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "vendor-profiles-book-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("fills a model's tiers from the newest list or promo version", () => {
    write(profileFile({}));
    const older = version({ id: "old", effectiveFrom: "2026-01-01", effectiveTo: "2026-10-26", tiers: [{ ...tier, inputUsdPerM: 9 }] });

    const [profile] = loadVendorProfiles(dir, bookOf([older, version()]));

    expect(profile?.models[0]?.tiers).toEqual([tier]);
    expect(profile?.models[0]?.promoEndsAt).toBeUndefined();
  });

  it("takes promoEndsAt from a promo version", () => {
    write(profileFile({}));
    const promo = version({ kind: "promo", promoEndsAt: "2026-12-01", effectiveTo: "2026-12-01" });

    expect(loadVendorProfiles(dir, bookOf([promo]))[0]?.models[0]?.promoEndsAt).toBe("2026-12-01");
  });

  it("fails fast, naming the file and model, when a model has no price anywhere", () => {
    write(profileFile({}));
    expect(() => loadVendorProfiles(dir, bookOf([]))).toThrow(/acme\.json.*"acme-big".*price book/);
  });

  it("refuses a model priced both in its profile and in the price book", () => {
    write(profileFile({ tiers: [tier] }));
    expect(() => loadVendorProfiles(dir, bookOf([version()]))).toThrow(/acme\.json.*"acme-big".*price book/);
  });

  it("keeps a profile's own tiers when the price book has none for the model", () => {
    write(profileFile({ tiers: [tier], promoEndsAt: "2026-12-01" }));
    expect(loadVendorProfiles(dir, bookOf([]))[0]?.models[0]).toMatchObject({ tiers: [tier], promoEndsAt: "2026-12-01" });
  });

  it("by default reads the price-book folder beside the profiles folder", () => {
    const root = mkdtempSync(path.join(tmpdir(), "fixtures-"));
    try {
      mkdirSync(path.join(root, "vendor-profiles"));
      mkdirSync(path.join(root, "price-book"));
      writeFileSync(path.join(root, "vendor-profiles", "acme.json"), JSON.stringify(profileFile({})));
      const { origin: _origin, ...bundled } = version();
      writeFileSync(
        path.join(root, "price-book", "github-copilot.json"),
        JSON.stringify({ channel: "github-copilot", sources: profileFile({}).sources, versions: [bundled] }),
      );

      expect(loadVendorProfiles(path.join(root, "vendor-profiles"))[0]?.models[0]?.tiers).toEqual([tier]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("bundled vendor profiles and price book", () => {
  const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures");
  const profilesDir = path.join(fixtures, "vendor-profiles");

  it("keeps no prices in the profile files", () => {
    for (const file of readdirSync(profilesDir).filter((name) => name.endsWith(".json"))) {
      const raw = JSON.parse(readFileSync(path.join(profilesDir, file), "utf-8")) as { models: Record<string, unknown>[] };
      for (const model of raw.models) {
        expect(Object.keys(model), `${file} ${String(model.modelId)}`).not.toContain("tiers");
        expect(Object.keys(model), `${file} ${String(model.modelId)}`).not.toContain("promoEndsAt");
      }
    }
  });

  it("gives every profile model exactly the price book's newest github-copilot tiers", () => {
    const book = new PriceBook(new BundledPriceBookSource(path.join(fixtures, "price-book")));
    for (const profile of loadVendorProfiles(profilesDir)) {
      for (const model of profile.models) {
        const newest = book.newestVersion("github-copilot", model.modelId);
        expect(model.tiers, model.modelId).toEqual(newest?.tiers);
        expect(model.promoEndsAt, model.modelId).toBe(newest?.promoEndsAt);
      }
    }
  });
});
