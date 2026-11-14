// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ProjectsFile } from "@agent-cost-analyzer/domain";
import { createBundledPriceBookBeside, createPriceBook } from "./create-price-book.js";

// 1.0 V2 (threat-model 5.10): only a projects file can add a "user" version,
// so the extension's bundled-only book can never mark a figure "your prices".
const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures");

describe("price book origins", () => {
  it("the extension's bundled-only book holds no user version", () => {
    const book = createBundledPriceBookBeside(path.join(fixtures, "vendor-profiles"));
    const versions = book?.list({}).versions ?? [];
    expect(versions.length).toBeGreaterThan(0);
    expect(versions.every((version) => version.origin === "bundled")).toBe(true);
  });

  it("the standalone book tags only the projects file's own versions as user", () => {
    const mine = {
      id: "mine-1",
      channel: "anthropic-api",
      modelId: "my-own-model",
      currency: "USD",
      effectiveFrom: "2030-01-01",
      tiers: [{ inputUsdPerM: 1, cachedInputUsdPerM: 0.1, cacheWriteUsdPerM: 1.25, outputUsdPerM: 5 }],
      kind: "list",
      sourceIds: [],
    };
    const file = { channels: { priceVersions: [mine] } } as unknown as ProjectsFile;
    const listed = createPriceBook(() => file, path.join(fixtures, "price-book")).list({}).versions;
    expect(listed.filter((version) => version.origin === "user").map((version) => version.id)).toEqual(["mine-1"]);
  });
});
