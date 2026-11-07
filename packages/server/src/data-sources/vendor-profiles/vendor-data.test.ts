// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  changeKindSchema,
  type ModelPrice,
  type PriceTier,
  type VendorProfile,
} from "@agent-cost-analyzer/domain";
import { findVendorModel, loadVendorProfiles } from "./loader.js";

// Step 13.2 exit criterion: the bundled profiles cover every model in the
// price-table snapshot, cite a source for every model and rule, and carry
// GitHub's prices exactly.
const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/vendor-profiles",
);
const snapshotPath = path.join(fixturesDir, "copilot-price-table.snapshot.yml");

type Row = Record<string, string>;

// The snapshot is a flat list of `key: value` maps; a full YAML parser
// would be a new dependency for a shape this small.
function parseTableRows(text: string): Row[] {
  const rows: Row[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const entry = trimmed.startsWith("- ") ? trimmed.slice(2) : trimmed;
    if (trimmed.startsWith("- ")) rows.push({});
    const match = /^([a-z_]+):\s*(.*)$/.exec(entry);
    if (match === null || rows.length === 0) {
      throw new Error(`Unexpected snapshot line: ${line}`);
    }
    rows[rows.length - 1][match[1]] = unquote(match[2]);
  }
  return rows;
}

function unquote(value: string): string {
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
  return value;
}

function displayNameOf(row: Row): string {
  return row.model.replace(/\[\^[^\]]+\]/g, "").trim();
}

function usd(value: string | undefined): number | null {
  if (value === undefined || value === "Not applicable") return null;
  const match = /^\$(\d+(?:\.\d+)?)$/.exec(value);
  if (match === null) throw new Error(`Unexpected price: ${value}`);
  return Number(match[1]);
}

// GitHub writes "≤ 200K" for the default tier and "> 200K" above it; the
// default tier's upper bound is inclusive.
function maxInputTokensOf(threshold: string | undefined): number | undefined {
  if (threshold === undefined || threshold === "Not applicable") {
    return undefined;
  }
  const upTo = /^≤ (\d+)K$/.exec(threshold);
  if (upTo !== null) return Number(upTo[1]) * 1000;
  if (/^> \d+K$/.test(threshold)) return undefined;
  throw new Error(`Unexpected threshold: ${threshold}`);
}

const vendorIdByProvider: Record<string, string> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  xai: "xai",
  microsoft: "microsoft",
  moonshot_ai: "moonshot",
};

interface TableModel {
  displayName: string;
  vendorId: string;
  releaseStatus: string;
  hasPromo: boolean;
  tiers: PriceTier[];
}

function tableModels(rows: Row[]): TableModel[] {
  const byName = new Map<string, TableModel>();
  for (const row of rows) {
    const displayName = displayNameOf(row);
    const vendorId = vendorIdByProvider[row.provider];
    if (vendorId === undefined) {
      throw new Error(`Unmapped provider: ${row.provider}`);
    }
    const tier: PriceTier = {
      inputUsdPerM: usd(row.input) ?? Number.NaN,
      cachedInputUsdPerM: usd(row.cached_input) ?? Number.NaN,
      cacheWriteUsdPerM: usd(row.cache_write),
      outputUsdPerM: usd(row.output) ?? Number.NaN,
    };
    const maxInputTokens = maxInputTokensOf(row.threshold);
    if (maxInputTokens !== undefined) tier.maxInputTokens = maxInputTokens;
    const existing = byName.get(displayName);
    if (existing === undefined) {
      byName.set(displayName, {
        displayName,
        vendorId,
        releaseStatus: row.release_status,
        hasPromo: row.model.includes("promo]"),
        tiers: [tier],
      });
    } else {
      existing.tiers.push(tier);
    }
  }
  return [...byName.values()];
}

// GitHub's table has no 1-hour write column; that price comes from the
// vendor's own docs, so it isn't part of the round trip.
function comparableTier(tier: PriceTier): PriceTier {
  const rest = { ...tier };
  delete rest.extendedCacheWriteUsdPerM;
  return rest;
}

const profiles: VendorProfile[] = loadVendorProfiles(fixturesDir);
const table = tableModels(parseTableRows(readFileSync(snapshotPath, "utf-8")));
const allModels: { profile: VendorProfile; model: ModelPrice }[] =
  profiles.flatMap((profile) =>
    profile.models.map((model) => ({ profile, model })),
  );

function byDisplayName(name: string) {
  return allModels.find(({ model }) => model.displayName === name);
}

describe("bundled vendor profiles (step 13.2)", () => {
  it("has one profile per Copilot vendor", () => {
    expect(profiles.map((profile) => profile.vendorId).sort()).toEqual([
      "anthropic",
      "google",
      "microsoft",
      "moonshot",
      "openai",
      "xai",
    ]);
  });

  it("parses the snapshot into models", () => {
    expect(table.length).toBeGreaterThan(0);
  });

  it("lists every snapshot model under its vendor", () => {
    for (const expected of table) {
      const found = byDisplayName(expected.displayName);
      expect(found, expected.displayName).toBeDefined();
      expect(found?.profile.vendorId).toBe(expected.vendorId);
      expect(found?.model.vendorId).toBe(expected.vendorId);
    }
  });

  it("lists no model the snapshot lacks", () => {
    expect(allModels.map(({ model }) => model.displayName).sort()).toEqual(
      table.map((model) => model.displayName).sort(),
    );
  });

  it("uses unique model ids that findVendorModel resolves", () => {
    const ids = allModels.map(({ model }) => model.modelId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const { profile, model } of allModels) {
      expect(findVendorModel(profiles, model.modelId)?.profile.vendorId).toBe(
        profile.vendorId,
      );
    }
  });

  it("round-trips every price tier exactly", () => {
    for (const expected of table) {
      const found = byDisplayName(expected.displayName);
      expect(
        found?.model.tiers.map(comparableTier),
        expected.displayName,
      ).toEqual(expected.tiers);
    }
  });

  it("keeps the snapshot's release status", () => {
    for (const expected of table) {
      expect(
        byDisplayName(expected.displayName)?.model.releaseStatus,
        expected.displayName,
      ).toBe(expected.releaseStatus);
    }
  });

  it("dates every model whose price is promotional", () => {
    for (const expected of table) {
      const promoEndsAt = byDisplayName(expected.displayName)?.model
        .promoEndsAt;
      if (expected.hasPromo) {
        expect(promoEndsAt, expected.displayName).toMatch(
          /^\d{4}-\d{2}-\d{2}$/,
        );
      } else {
        expect(promoEndsAt, expected.displayName).toBeUndefined();
      }
    }
  });

  it("cites a resolvable source for every model", () => {
    for (const { profile, model } of allModels) {
      const known = new Set(profile.sources.map((source) => source.id));
      expect(model.sourceIds.length, model.modelId).toBeGreaterThan(0);
      for (const id of model.sourceIds) {
        expect(known.has(id), `${model.modelId} -> ${id}`).toBe(true);
      }
    }
  });

  it("cites a resolvable source for every rule that isn't unknown", () => {
    for (const profile of profiles) {
      const known = new Set(profile.sources.map((source) => source.id));
      for (const rule of profile.invalidation) {
        const label = `${profile.vendorId} ${rule.change}`;
        if (rule.confidence === "unknown") {
          expect(rule.invalidatesFrom, label).toBe("unknown");
          continue;
        }
        expect(rule.sourceIds.length, label).toBeGreaterThan(0);
        for (const id of rule.sourceIds) {
          expect(known.has(id), `${label} -> ${id}`).toBe(true);
        }
      }
    }
  });

  it("states each change kind exactly once per vendor", () => {
    for (const profile of profiles) {
      expect(
        profile.invalidation.map((rule) => rule.change).sort(),
        profile.vendorId,
      ).toEqual([...changeKindSchema.options].sort());
    }
  });

  it("resolves every assumption's sources", () => {
    for (const profile of profiles) {
      const known = new Set(profile.sources.map((source) => source.id));
      for (const assumption of profile.assumptions) {
        for (const id of assumption.sourceIds ?? []) {
          expect(known.has(id), `${profile.vendorId} -> ${id}`).toBe(true);
        }
      }
    }
  });

  it("dates every source and keeps source ids unique", () => {
    for (const profile of profiles) {
      const ids = profile.sources.map((source) => source.id);
      expect(new Set(ids).size, profile.vendorId).toBe(ids.length);
      for (const source of profile.sources) {
        expect(source.checkedAt, source.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(source.url, source.id).toMatch(/^https:\/\//);
      }
    }
  });

  it("leaves Moonshot AI and Microsoft unsimulated (D1)", () => {
    for (const vendorId of ["moonshot", "microsoft"]) {
      const profile = profiles.find((p) => p.vendorId === vendorId);
      expect(profile?.caching.kind, vendorId).toBe("unknown");
    }
    for (const vendorId of ["anthropic", "openai", "google", "xai"]) {
      const profile = profiles.find((p) => p.vendorId === vendorId);
      expect(profile?.caching.kind, vendorId).not.toBe("unknown");
    }
  });

  it("names a default model each profile lists", () => {
    for (const profile of profiles) {
      expect(
        profile.models.some(
          (model) => model.modelId === profile.defaultModelId,
        ),
        profile.vendorId,
      ).toBe(true);
    }
  });

  it("falls back to Claude Sonnet 5.5 for Anthropic (D3)", () => {
    const anthropic = profiles.find((p) => p.vendorId === "anthropic");
    expect(anthropic?.defaultModelId).toBe("claude-sonnet-5.5");
  });

  it("points every cheaper sibling at a cheaper model of the same vendor", () => {
    for (const { profile, model } of allModels) {
      if (model.cheaperSiblingId === undefined) continue;
      const sibling = profile.models.find(
        (candidate) => candidate.modelId === model.cheaperSiblingId,
      );
      expect(sibling, model.modelId).toBeDefined();
      expect(sibling?.tiers[0].inputUsdPerM).toBeLessThan(
        model.tiers[0].inputUsdPerM,
      );
      expect(sibling?.tiers[0].outputUsdPerM).toBeLessThan(
        model.tiers[0].outputUsdPerM,
      );
    }
  });
});
