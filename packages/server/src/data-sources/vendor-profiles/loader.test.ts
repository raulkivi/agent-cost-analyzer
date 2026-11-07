// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModelPrice, VendorProfile } from "@agent-cost-analyzer/domain";
import { findVendorModel, loadVendorProfiles } from "./loader.js";

function model(
  modelId: string,
  overrides: Partial<ModelPrice> = {},
): ModelPrice {
  return {
    modelId,
    displayName: modelId,
    vendorId: "acme",
    releaseStatus: "ga",
    tiers: [
      {
        inputUsdPerM: 3,
        cachedInputUsdPerM: 0.3,
        cacheWriteUsdPerM: 3.75,
        outputUsdPerM: 15,
      },
    ],
    sourceIds: ["doc"],
    ...overrides,
  };
}

function profile(
  vendorId: string,
  overrides: Partial<VendorProfile> = {},
): VendorProfile {
  return {
    vendorId,
    displayName: vendorId,
    defaultModelId: `${vendorId}-big`,
    caching: { kind: "best-effort", note: "n" },
    invalidation: [
      {
        change: "tools-changed",
        invalidatesFrom: "tools",
        confidence: "documented",
        sourceIds: ["doc"],
      },
    ],
    models: [
      model(`${vendorId}-big`, {
        vendorId,
        cheaperSiblingId: `${vendorId}-small`,
      }),
      model(`${vendorId}-small`, { vendorId }),
    ],
    assumptions: [{ text: "a", confidence: "inferred", sourceIds: ["doc"] }],
    sources: [
      {
        id: "doc",
        title: "Doc",
        url: "https://example.com",
        checkedAt: "2026-11-05",
      },
    ],
    ...overrides,
  };
}

describe("loadVendorProfiles", () => {
  let dir: string;

  const write = (file: string, content: unknown): void =>
    writeFileSync(
      path.join(dir, file),
      typeof content === "string" ? content : JSON.stringify(content),
    );

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "vendor-profiles-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads every profile sorted by filename", () => {
    write("b.json", profile("beta"));
    write("a.json", profile("alpha"));

    expect(loadVendorProfiles(dir).map((p) => p.vendorId)).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("returns [] for an empty directory", () => {
    expect(loadVendorProfiles(dir)).toEqual([]);
  });

  it("ignores non-json files", () => {
    write("a.json", profile("alpha"));
    write("notes.md", "not json");
    write("a.json.bak", "not json");

    expect(loadVendorProfiles(dir)).toHaveLength(1);
  });

  it("names the file when schema validation fails", () => {
    write("bad.json", { vendorId: "x" });

    expect(() => loadVendorProfiles(dir)).toThrow(/bad\.json/);
  });

  it("rejects a duplicate vendorId across files", () => {
    write("a.json", profile("alpha"));
    write("b.json", profile("alpha"));

    expect(() => loadVendorProfiles(dir)).toThrow(
      /b\.json.*duplicate vendorId "alpha"/i,
    );
  });

  it("rejects a defaultModelId that is not among the models", () => {
    write("a.json", profile("alpha", { defaultModelId: "ghost" }));

    expect(() => loadVendorProfiles(dir)).toThrow(
      /a\.json.*defaultModelId "ghost"/,
    );
  });

  it("rejects a cheaperSiblingId that is not among the models", () => {
    write(
      "a.json",
      profile("alpha", {
        models: [model("alpha-big", { cheaperSiblingId: "ghost" })],
        defaultModelId: "alpha-big",
      }),
    );

    expect(() => loadVendorProfiles(dir)).toThrow(
      /a\.json.*cheaperSiblingId "ghost"/,
    );
  });

  it("rejects an invalidation rule citing an unknown source", () => {
    write(
      "a.json",
      profile("alpha", {
        invalidation: [
          {
            change: "tools-changed",
            invalidatesFrom: "tools",
            confidence: "documented",
            sourceIds: ["ghost"],
          },
        ],
      }),
    );

    expect(() => loadVendorProfiles(dir)).toThrow(
      /a\.json.*invalidation.*"ghost"/,
    );
  });

  it("rejects a model citing an unknown source", () => {
    write(
      "a.json",
      profile("alpha", {
        models: [model("alpha-big", { sourceIds: ["ghost"] })],
        defaultModelId: "alpha-big",
      }),
    );

    expect(() => loadVendorProfiles(dir)).toThrow(
      /a\.json.*model "alpha-big".*"ghost"/,
    );
  });

  it("rejects an assumption citing an unknown source", () => {
    write(
      "a.json",
      profile("alpha", {
        assumptions: [
          { text: "a", confidence: "inferred", sourceIds: ["ghost"] },
        ],
      }),
    );

    expect(() => loadVendorProfiles(dir)).toThrow(
      /a\.json.*assumption.*"ghost"/,
    );
  });

  it("rejects a model without sourceIds", () => {
    write(
      "a.json",
      profile("alpha", {
        models: [model("alpha-big", { sourceIds: [] })],
        defaultModelId: "alpha-big",
      }),
    );

    expect(() => loadVendorProfiles(dir)).toThrow(
      /a\.json.*model "alpha-big".*no sourceIds/,
    );
  });
});

describe("findVendorModel", () => {
  const profiles = [profile("alpha"), profile("beta")];

  it("returns the owning profile and the model", () => {
    const found = findVendorModel(profiles, "beta-small");

    expect(found?.profile.vendorId).toBe("beta");
    expect(found?.model.modelId).toBe("beta-small");
  });

  it("returns undefined for an unknown model", () => {
    expect(findVendorModel(profiles, "ghost")).toBeUndefined();
  });
});

describe("loadVendorProfiles default directory", () => {
  it("loads the six bundled profiles when no directory is given", () => {
    expect(loadVendorProfiles()).toHaveLength(6);
  });
});
