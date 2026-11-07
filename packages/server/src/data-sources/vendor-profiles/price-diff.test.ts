// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { ModelPrice, VendorProfile } from "@agent-cost-analyzer/domain";
import {
  diffPrices,
  formatDiffReport,
  hasDifferences,
  parsePriceTable,
} from "./price-diff.js";

const TABLE = `# header comment
# - model: not a row

# OpenAI
- model: GPT-5.4 nano
  provider: openai
  release_status: GA
  threshold: Not applicable
  tier: Default
  input: $0.20
  cached_input: $0.02
  output: $1.25
  cache_write: Not applicable

- model: Claude Haiku 5.5
  provider: anthropic
  threshold: '≤ 100K'
  tier: Default
  input: $0.10
  cached_input: $0.01
  output: $0.50
  cache_write: $0.125

- model: Claude Haiku 5.5
  provider: anthropic
  threshold: '> 100K'
  tier: 'Long context'
  input: $0.50
  cached_input: $0.05
  output: $2.50
  cache_write: $0.625
`;

function model(displayName: string, tiers: ModelPrice["tiers"]): ModelPrice {
  return {
    modelId: displayName.toLowerCase().replace(/ /g, "-"),
    displayName,
    vendorId: "v",
    releaseStatus: "GA",
    tiers,
    sourceIds: ["s"],
  };
}
const profile = (models: ModelPrice[]): VendorProfile => ({
  vendorId: "v",
  displayName: "V",
  defaultModelId: models[0]!.modelId,
  caching: { kind: "unknown", reason: "r" },
  invalidation: [],
  models,
  assumptions: [],
  sources: [{ id: "s", title: "t", url: "u", checkedAt: "2026-11-05" }],
});
const nano = model("GPT-5.4 nano", [
  {
    inputUsdPerM: 0.2,
    cachedInputUsdPerM: 0.02,
    cacheWriteUsdPerM: null,
    outputUsdPerM: 1.25,
  },
]);
const haiku = model("Claude Haiku 5.5", [
  {
    maxInputTokens: 100000,
    inputUsdPerM: 0.1,
    cachedInputUsdPerM: 0.01,
    cacheWriteUsdPerM: 0.125,
    outputUsdPerM: 0.5,
  },
  {
    inputUsdPerM: 0.5,
    cachedInputUsdPerM: 0.05,
    cacheWriteUsdPerM: 0.625,
    outputUsdPerM: 2.5,
  },
]);

describe("parsePriceTable", () => {
  it("reads one row per tier, ignoring comments and blank lines", () => {
    const rows = parsePriceTable(TABLE);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      model: "GPT-5.4 nano",
      input: 0.2,
      cachedInput: 0.02,
      output: 1.25,
      cacheWrite: null,
    });
    expect(rows[2]).toMatchObject({
      model: "Claude Haiku 5.5",
      cacheWrite: 0.625,
    });
  });

  it("drops a footnote marker from the model name and reads a missing cache_write as none", () => {
    const rows = parsePriceTable(
      "- model: 'Gemini 4 Argon[^promo]'\n  provider: google\n  input: $2.00\n  cached_input: $0.10\n  output: $10.00\n",
    );
    expect(rows).toEqual([
      {
        model: "Gemini 4 Argon",
        input: 2,
        cachedInput: 0.1,
        output: 10,
        cacheWrite: null,
      },
    ]);
  });

  it("rejects a price it cannot read rather than guessing", () => {
    expect(() =>
      parsePriceTable(
        "- model: X\n  input: free\n  cached_input: $1\n  output: $1\n  cache_write: Not applicable\n",
      ),
    ).toThrow(/input/);
  });
});

describe("diffPrices", () => {
  const rows = parsePriceTable(TABLE);

  it("reports nothing when profiles match the table", () => {
    const diff = diffPrices([profile([nano, haiku])], rows);
    expect(hasDifferences(diff)).toBe(false);
  });

  it("reports a model only in the table as added", () => {
    const diff = diffPrices([profile([nano])], rows);
    expect(diff.added).toEqual(["Claude Haiku 5.5"]);
  });

  it("reports a model only in a profile as removed", () => {
    const extra = model("Old Model", nano.tiers);
    const diff = diffPrices([profile([nano, haiku, extra])], rows);
    expect(diff.removed).toEqual(["Old Model"]);
  });

  it("reports a changed price with the old and new value", () => {
    const pricier = model("GPT-5.4 nano", [
      { ...nano.tiers[0]!, outputUsdPerM: 2 },
    ]);
    const diff = diffPrices([profile([pricier, haiku])], rows);
    expect(diff.changed).toEqual([
      {
        model: "GPT-5.4 nano",
        differences: ["tier 1 output: profile $2 → table $1.25"],
      },
    ]);
  });

  it("reports a cache-write price that appeared or disappeared", () => {
    const withWrite = model("GPT-5.4 nano", [
      { ...nano.tiers[0]!, cacheWriteUsdPerM: 0.25 },
    ]);
    const diff = diffPrices([profile([withWrite, haiku])], rows);
    expect(diff.changed[0]!.differences[0]).toContain("cacheWrite");
  });

  it("reports a different number of tiers", () => {
    const oneTier = model("Claude Haiku 5.5", [haiku.tiers[0]!]);
    const diff = diffPrices([profile([nano, oneTier])], rows);
    expect(diff.changed[0]!.differences[0]).toContain("tiers");
  });
});

describe("formatDiffReport", () => {
  it("lists added, removed and changed models in markdown", () => {
    const report = formatDiffReport({
      added: ["A"],
      removed: ["B"],
      changed: [
        { model: "C", differences: ["tier 1 input: profile $1 → table $2"] },
      ],
    });
    expect(report).toContain("## Added");
    expect(report).toContain("- A");
    expect(report).toContain("## Removed");
    expect(report).toContain("## Changed");
    expect(report).toContain("**C**");
  });

  it("says so when nothing differs", () => {
    expect(formatDiffReport({ added: [], removed: [], changed: [] })).toMatch(
      /no differences/i,
    );
  });
});
