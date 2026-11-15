// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadVendorProfiles } from "../data-sources/vendor-profiles/loader.js";
import { BundledPriceBookSource } from "../services/pricing/bundled-price-book-source.js";
import { PriceBook } from "../services/pricing/price-book.js";
import { FIXTURE_VENDOR_PROFILES_DIR } from "../test-support/vendor-profiles-dir.js";
import { loadBundledVendorProfiles } from "./bundled-vendor-profiles.js";

const FIXTURE_PRICE_BOOK_DIR = path.join(FIXTURE_VENDOR_PROFILES_DIR, "..", "price-book");

describe("loadBundledVendorProfiles", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "bundled-vendor-profiles-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("prices the profiles from the given price book, even when it isn't beside them", () => {
    const profilesDir = path.join(dir, "profiles");
    const priceBookDir = path.join(dir, "elsewhere", "book");
    mkdirSync(path.dirname(priceBookDir), { recursive: true });
    cpSync(path.join(FIXTURE_VENDOR_PROFILES_DIR, "anthropic.json"), path.join(profilesDir, "anthropic.json"), { recursive: true });
    cpSync(FIXTURE_PRICE_BOOK_DIR, priceBookDir, { recursive: true });

    const [profile] = loadBundledVendorProfiles({ vendorProfilesDir: profilesDir, priceBookDir });

    const book = new PriceBook(new BundledPriceBookSource(priceBookDir));
    const sonnet = profile!.models.find((model) => model.modelId === "claude-sonnet-5.5")!;
    expect(profile!.vendorId).toBe("anthropic");
    expect(sonnet.tiers).toEqual(book.newestVersion("github-copilot", "claude-sonnet-5.5")!.tiers);
    // The loader on its own looks only beside the profiles, and finds no prices there.
    expect(() => loadVendorProfiles(profilesDir)).toThrow(/no github-copilot price/);
  });

  it("without a price book folder, uses the one beside the profiles, as before", () => {
    expect(loadBundledVendorProfiles({ vendorProfilesDir: FIXTURE_VENDOR_PROFILES_DIR })).toEqual(loadVendorProfiles(FIXTURE_VENDOR_PROFILES_DIR));
  });
});
