// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BundledPriceBookSource, defaultPriceBookDir } from "./bundled-price-book-source.js";
import { PriceBook } from "./price-book.js";

// Step 15.5 exit criterion over the bundled data: every version has a
// source, nothing overlaps, gaps are flagged (and there are none), history
// starts no earlier than D8's 2026-01-01, and every model Phase 13 simulates
// has a current Copilot price.
const profilesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/vendor-profiles");
const profileModelIds = readdirSync(profilesDir)
  .filter((file) => file.endsWith(".json"))
  .flatMap((file) => (JSON.parse(readFileSync(path.join(profilesDir, file), "utf-8")) as { models: { modelId: string }[] }).models)
  .map((model) => model.modelId);

const source = new BundledPriceBookSource(defaultPriceBookDir());
const book = new PriceBook(source);
const { versions, sources } = source.load();

describe("bundled price book (step 15.5)", () => {
  it("holds the GitHub Copilot channel", () => {
    expect(book.list({}).channels).toContain("github-copilot");
  });

  it("cites at least one dated https source for every version, GitHub's price table first on github-copilot", () => {
    const byId = new Map(sources.map((cited) => [cited.id, cited]));
    for (const version of versions) {
      // On github-copilot: the table as of the commit that proves the version's start (D8 history).
      if (version.channel === "github-copilot") expect(version.sourceIds[0], version.id).toMatch(/^gh-pricing-table/);
      expect(version.sourceIds.length, version.id).toBeGreaterThan(0);
      for (const id of version.sourceIds) {
        expect(byId.get(id)?.checkedAt, `${version.id} -> ${id}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(byId.get(id)?.url, `${version.id} -> ${id}`).toMatch(/^https:\/\//);
      }
    }
  });

  it("names every version <channel>:<modelId>:<effectiveFrom>", () => {
    for (const version of versions) {
      expect(version.id).toBe(`${version.channel}:${version.modelId}:${version.effectiveFrom}`);
    }
  });

  it("has no gaps and starts no earlier than 2026-01-01 (D8)", () => {
    expect(book.list({}).gaps).toEqual([]);
    for (const version of versions) expect(version.effectiveFrom >= "2026-01-01", version.id).toBe(true);
  });

  it("prices every Phase 13 model on github-copilot; any other model there is one GitHub has removed", () => {
    const copilot = versions.filter((version) => version.channel === "github-copilot");
    expect(profileModelIds.every((modelId) => copilot.some((version) => version.modelId === modelId))).toBe(true);
    // Removed models stay so the turns that used them are priced; each ends.
    for (const version of copilot.filter((candidate) => !profileModelIds.includes(candidate.modelId))) {
      expect(version.effectiveTo, version.id).toBeDefined();
    }
    for (const modelId of profileModelIds) {
      expect(book.newestVersion("github-copilot", modelId), modelId).toBeDefined();
    }
  });

  it("ends each promotional price when GitHub says the promotion ends, leaving the price after it unknown", () => {
    // Copilot's only: a vendor channel such as google-api states the price after a promotion.
    const promos = versions.filter((version) => version.channel === "github-copilot" && version.kind === "promo");
    expect(promos.length).toBeGreaterThan(0);
    for (const promo of promos) {
      expect(promo.effectiveTo, promo.id).toBeDefined();
      expect(book.priceFor("github-copilot", promo.modelId, `${promo.effectiveTo}T00:00:00Z`)).toEqual({
        known: false,
        reason: `no price for ${promo.modelId} on github-copilot from ${promo.effectiveTo}`,
      });
    }
  });

  it("prices a turn at the snapshot's date and leaves an earlier turn unknown with a reason", () => {
    expect(book.priceFor("github-copilot", "claude-sonnet-5.5", "2026-11-05T10:00:00Z")).toMatchObject({ known: true });
    const before = book.priceFor("github-copilot", "claude-sonnet-5.5", "2026-03-01T10:00:00Z");
    expect(before.known).toBe(false);
  });
});
