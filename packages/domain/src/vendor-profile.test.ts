// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  cachingKindSchema,
  changeKindSchema,
  confidenceSchema,
  harnessSchema,
  invalidationRuleSchema,
  layerSchema,
  modelPriceSchema,
  sourceSchema,
  vendorProfileSchema,
} from "./vendor-profile.js";

function without<T extends object>(obj: T, key: keyof T): Partial<T> {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}

const source = {
  id: "anthropic-caching",
  title: "Prompt caching",
  url: "https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching",
  checkedAt: "2026-11-05",
};

const tier = {
  inputUsdPerM: 3,
  cachedInputUsdPerM: 0.3,
  cacheWriteUsdPerM: 3.75,
  outputUsdPerM: 15,
};

const breakpoints = {
  kind: "breakpoints",
  defaultTtlMinutes: 5,
  refreshOnHit: true,
  minCacheableTokens: 1024,
  layers: ["tools", "system", "messages"],
};

const price = {
  modelId: "claude-sonnet-5-5",
  displayName: "Claude Sonnet 5.5",
  vendorId: "anthropic",
  releaseStatus: "ga",
  tiers: [tier],
  sourceIds: ["anthropic-caching"],
};

const profile = {
  vendorId: "anthropic",
  displayName: "Anthropic",
  defaultModelId: "claude-sonnet-5-5",
  caching: breakpoints,
  invalidation: [
    {
      change: "tools-changed",
      invalidatesFrom: "tools",
      confidence: "documented",
      sourceIds: ["anthropic-caching"],
    },
  ],
  models: [price],
  assumptions: [
    {
      text: "Copilot places breakpoints at the end of system.",
      confidence: "inferred",
    },
  ],
  sources: [source],
};

describe("enums", () => {
  it("accepts the documented layers, harnesses, confidences", () => {
    expect(layerSchema.options).toEqual(["tools", "system", "messages"]);
    expect(harnessSchema.options).toEqual([
      "vscode-local",
      "copilot-agent-host",
      "claude-code",
    ]);
    expect(confidenceSchema.options).toEqual([
      "documented",
      "inferred",
      "unknown",
    ]);
  });

  it("lists every change kind a rule can key on", () => {
    expect(changeKindSchema.options).toEqual([
      "tools-changed",
      "system-changed",
      "image-added",
      "image-removed",
      "thinking-changed",
      "model-switch",
      "tool-choice-changed",
    ]);
  });

  it("rejects an unknown layer", () => {
    expect(layerSchema.safeParse("history").success).toBe(false);
  });
});

describe("sourceSchema", () => {
  it("accepts a source with and without a quote", () => {
    expect(sourceSchema.safeParse(source).success).toBe(true);
    expect(
      sourceSchema.safeParse({ ...source, quote: "Cache lasts 5 minutes" })
        .success,
    ).toBe(true);
  });

  it("rejects a source without checkedAt", () => {
    const rest = without(source, "checkedAt");
    expect(sourceSchema.safeParse(rest).success).toBe(false);
  });
});

describe("cachingKindSchema", () => {
  it("accepts breakpoints with optional extended TTL", () => {
    expect(cachingKindSchema.safeParse(breakpoints).success).toBe(true);
    expect(
      cachingKindSchema.safeParse({ ...breakpoints, extendedTtlMinutes: 60 })
        .success,
    ).toBe(true);
  });

  it("rejects breakpoints without minCacheableTokens", () => {
    const rest = without(breakpoints, "minCacheableTokens");
    expect(cachingKindSchema.safeParse(rest).success).toBe(false);
  });

  it("accepts automatic-prefix with a ttl range or a fixed ttl", () => {
    const base = {
      kind: "automatic-prefix",
      writeCharged: false,
      minCacheableTokens: 1024,
    };
    expect(
      cachingKindSchema.safeParse({ ...base, ttlMinutes: { min: 5, max: 10 } })
        .success,
    ).toBe(true);
    expect(
      cachingKindSchema.safeParse({
        ...base,
        ttlMinutes: { fixed: 60 },
        incrementTokens: 128,
      }).success,
    ).toBe(true);
  });

  it("rejects automatic-prefix with an empty ttl or missing writeCharged", () => {
    expect(
      cachingKindSchema.safeParse({
        kind: "automatic-prefix",
        ttlMinutes: {},
        writeCharged: true,
        minCacheableTokens: 1,
      }).success,
    ).toBe(false);
    expect(
      cachingKindSchema.safeParse({
        kind: "automatic-prefix",
        ttlMinutes: { fixed: 5 },
        minCacheableTokens: 1,
      }).success,
    ).toBe(false);
  });

  it("accepts best-effort with a note and rejects it without", () => {
    expect(
      cachingKindSchema.safeParse({
        kind: "best-effort",
        note: "lifetime assumed",
      }).success,
    ).toBe(true);
    expect(cachingKindSchema.safeParse({ kind: "best-effort" }).success).toBe(
      false,
    );
  });

  it("accepts unknown with a reason and rejects an empty or missing one", () => {
    expect(
      cachingKindSchema.safeParse({ kind: "unknown", reason: "not published" })
        .success,
    ).toBe(true);
    expect(
      cachingKindSchema.safeParse({ kind: "unknown", reason: "" }).success,
    ).toBe(false);
    expect(cachingKindSchema.safeParse({ kind: "unknown" }).success).toBe(
      false,
    );
  });

  it("rejects an unknown kind discriminator", () => {
    expect(cachingKindSchema.safeParse({ kind: "magic" }).success).toBe(false);
  });
});

describe("invalidationRuleSchema", () => {
  const rule = {
    change: "image-added",
    invalidatesFrom: "messages",
    confidence: "documented",
    sourceIds: ["anthropic-caching"],
  };

  it("accepts a documented rule with sources", () => {
    expect(invalidationRuleSchema.safeParse(rule).success).toBe(true);
  });

  it("accepts nothing and unknown as invalidatesFrom, plus modelSpecific", () => {
    expect(
      invalidationRuleSchema.safeParse({ ...rule, invalidatesFrom: "nothing" })
        .success,
    ).toBe(true);
    expect(
      invalidationRuleSchema.safeParse({
        ...rule,
        invalidatesFrom: "unknown",
        confidence: "unknown",
        sourceIds: [],
      }).success,
    ).toBe(true);
    expect(
      invalidationRuleSchema.safeParse({ ...rule, modelSpecific: true })
        .success,
    ).toBe(true);
  });

  it("rejects a documented rule without sources", () => {
    expect(
      invalidationRuleSchema.safeParse({ ...rule, sourceIds: [] }).success,
    ).toBe(false);
  });

  it("rejects an unknown-confidence rule that carries sources", () => {
    expect(
      invalidationRuleSchema.safeParse({ ...rule, confidence: "unknown" })
        .success,
    ).toBe(false);
  });

  it("allows an inferred rule with or without sources", () => {
    expect(
      invalidationRuleSchema.safeParse({
        ...rule,
        confidence: "inferred",
        sourceIds: [],
      }).success,
    ).toBe(true);
    expect(
      invalidationRuleSchema.safeParse({ ...rule, confidence: "inferred" })
        .success,
    ).toBe(true);
  });
});

describe("modelPriceSchema", () => {
  it("accepts a single-tier price", () => {
    expect(modelPriceSchema.safeParse(price).success).toBe(true);
  });

  it("accepts a null cache write price", () => {
    expect(
      modelPriceSchema.safeParse({
        ...price,
        tiers: [{ ...tier, cacheWriteUsdPerM: null }],
      }).success,
    ).toBe(true);
  });

  it("accepts multiple tiers with maxInputTokens and an extended write price", () => {
    const tiers = [
      { ...tier, maxInputTokens: 200000, extendedCacheWriteUsdPerM: 6 },
      { ...tier, inputUsdPerM: 6, outputUsdPerM: 22.5 },
    ];
    expect(modelPriceSchema.safeParse({ ...price, tiers }).success).toBe(true);
  });

  it("accepts the optional fields", () => {
    expect(
      modelPriceSchema.safeParse({
        ...price,
        cachingKind: { kind: "best-effort", note: "n" },
        cheaperSiblingId: "claude-haiku-5-5",
        promoEndsAt: "2026-12-31",
      }).success,
    ).toBe(true);
  });

  it("rejects empty tiers and a missing cacheWriteUsdPerM", () => {
    expect(modelPriceSchema.safeParse({ ...price, tiers: [] }).success).toBe(
      false,
    );
    const noWrite = without(tier, "cacheWriteUsdPerM");
    expect(
      modelPriceSchema.safeParse({ ...price, tiers: [noWrite] }).success,
    ).toBe(false);
  });
});

describe("vendorProfileSchema", () => {
  it("accepts a complete profile", () => {
    expect(vendorProfileSchema.safeParse(profile).success).toBe(true);
  });

  it("rejects a profile whose invalidation rule is documented without sources", () => {
    const bad = {
      ...profile,
      invalidation: [{ ...profile.invalidation[0], sourceIds: [] }],
    };
    expect(vendorProfileSchema.safeParse(bad).success).toBe(false);
  });

  it("applies the confidence refinement to assumptions", () => {
    const withSources = (confidence: string, sourceIds: string[]) => ({
      ...profile,
      assumptions: [{ text: "x", confidence, sourceIds }],
    });
    expect(
      vendorProfileSchema.safeParse(withSources("documented", [])).success,
    ).toBe(false);
    expect(
      vendorProfileSchema.safeParse(
        withSources("unknown", ["anthropic-caching"]),
      ).success,
    ).toBe(false);
    expect(
      vendorProfileSchema.safeParse(
        withSources("documented", ["anthropic-caching"]),
      ).success,
    ).toBe(true);
  });

  it("rejects a profile without a caching kind", () => {
    const rest = without(profile, "caching");
    expect(vendorProfileSchema.safeParse(rest).success).toBe(false);
  });
});
