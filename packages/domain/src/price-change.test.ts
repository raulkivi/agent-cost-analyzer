// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { PriceVersion } from "./price-book.js";
import { documentedPriceChanges, priceChangeMarkerSchema } from "./price-change.js";

// Phase 15 step 15.7 (plan §6.4 point 1, §10.1.1): the documented price
// changes a cost series marks in its range, from the price book's version
// boundaries. Markers only; the PriceChangeDetector is step 15.10's.

function version(overrides: Partial<PriceVersion> & Pick<PriceVersion, "id" | "effectiveFrom">): PriceVersion {
  return {
    channel: "github-copilot",
    modelId: "claude-sonnet-5.5",
    currency: "USD",
    tiers: [{ inputUsdPerM: 2, cachedInputUsdPerM: 0.2, cacheWriteUsdPerM: 2.5, extendedCacheWriteUsdPerM: 4, outputUsdPerM: 10 }],
    kind: "list",
    sourceIds: ["s1"],
    ...overrides,
  };
}

const before = version({ id: "gh:sonnet:2026-10-01", effectiveFrom: "2026-10-01", effectiveTo: "2026-10-07" });
const after = version({
  id: "gh:sonnet:2026-10-07",
  effectiveFrom: "2026-10-07",
  tiers: [{ inputUsdPerM: 2, cachedInputUsdPerM: 0.1, cacheWriteUsdPerM: 2.5, extendedCacheWriteUsdPerM: 4, outputUsdPerM: 10 }],
  sourceIds: ["s2"],
});

describe("documentedPriceChanges", () => {
  it("marks a boundary between two adjacent versions with the token types whose price changed", () => {
    const markers = documentedPriceChanges([after, before]);
    expect(markers).toEqual([
      {
        kind: "documented",
        date: "2026-10-07",
        channel: "github-copilot",
        modelId: "claude-sonnet-5.5",
        fromVersionId: "gh:sonnet:2026-10-01",
        toVersionId: "gh:sonnet:2026-10-07",
        changes: [{ tier: 0, tokenType: "cachedInput", fromUsdPerM: 0.2, toUsdPerM: 0.1, percent: -50 }],
        sourceIds: ["s2"],
      },
    ]);
    for (const marker of markers) priceChangeMarkerSchema.parse(marker);
  });

  it("gives a price that appears (or disappears) a null side and no percentage", () => {
    const old = version({ id: "a", effectiveFrom: "2026-10-01", effectiveTo: "2026-10-20", tiers: [{ inputUsdPerM: 2, cachedInputUsdPerM: 0.1, cacheWriteUsdPerM: 2.5, outputUsdPerM: 10 }] });
    const added = version({ id: "b", effectiveFrom: "2026-10-20", tiers: [{ inputUsdPerM: 2, cachedInputUsdPerM: 0.1, cacheWriteUsdPerM: 2.5, extendedCacheWriteUsdPerM: 5, outputUsdPerM: 10 }] });
    expect(documentedPriceChanges([old, added])[0]?.changes).toEqual([
      { tier: 0, tokenType: "extendedCacheWrite", fromUsdPerM: null, toUsdPerM: 5, percent: null },
    ]);
  });

  it("keeps markers inside the inclusive date range and for the asked channel/model pairs only", () => {
    expect(documentedPriceChanges([before, after], { since: "2026-10-08" })).toEqual([]);
    expect(documentedPriceChanges([before, after], { until: "2026-10-06" })).toEqual([]);
    expect(documentedPriceChanges([before, after], { since: "2026-10-07", until: "2026-10-07" })).toHaveLength(1);
    expect(documentedPriceChanges([before, after], { pairs: [{ channel: "anthropic-api", modelId: "claude-sonnet-5.5" }] })).toEqual([]);
    expect(documentedPriceChanges([before, after], { pairs: [{ channel: "github-copilot", modelId: "claude-sonnet-5.5" }] })).toHaveLength(1);
  });

  it("does not mark a gap, an end with no successor, a change of sources only, or a contract against a list price", () => {
    const gapAfter = { ...after, id: "gap", effectiveFrom: "2026-10-09" };
    const sameAgain = version({ id: "same", effectiveFrom: "2026-10-07", sourceIds: ["s3"] });
    const contract = { ...after, id: "contract", kind: "contract" as const, sourceIds: [] };
    expect(documentedPriceChanges([before, gapAfter])).toEqual([]);
    expect(documentedPriceChanges([before])).toEqual([]);
    expect(documentedPriceChanges([before, sameAgain])).toEqual([]);
    expect(documentedPriceChanges([before, contract])).toEqual([]);
  });

  it("orders markers by date, then channel and model", () => {
    const otherBefore = { ...before, id: "x1", channel: "anthropic-api" };
    const otherAfter = { ...after, id: "x2", channel: "anthropic-api" };
    expect(documentedPriceChanges([before, after, otherAfter, otherBefore]).map((marker) => marker.channel)).toEqual(["anthropic-api", "github-copilot"]);
  });
});
