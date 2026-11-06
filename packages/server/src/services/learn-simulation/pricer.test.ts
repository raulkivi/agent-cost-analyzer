import { describe, expect, it } from "vitest";
import type { ModelPrice } from "@agent-cost-analyzer/domain";
import { priceTurn } from "./pricer.js";

const sonnet: ModelPrice = {
  modelId: "m",
  displayName: "M",
  vendorId: "v",
  releaseStatus: "GA",
  tiers: [
    {
      inputUsdPerM: 3,
      cachedInputUsdPerM: 0.3,
      cacheWriteUsdPerM: 3.75,
      extendedCacheWriteUsdPerM: 6,
      outputUsdPerM: 15,
    },
  ],
  sourceIds: ["s"],
};
const none = {
  uncachedInput: 0,
  cacheRead: 0,
  cacheWrite: 0,
  extendedCacheWrite: 0,
  output: 0,
};

describe("priceTurn", () => {
  it("converts USD to AI credits at 1 credit = $0.01", () => {
    const cost = priceTurn(sonnet, { ...none, uncachedInput: 1_000_000 });
    expect(cost.usd).toBeCloseTo(3);
    expect(cost.aiCredits).toBeCloseTo(300);
  });

  it("prices each bucket at its own rate", () => {
    const cost = priceTurn(sonnet, {
      uncachedInput: 1_000_000,
      cacheRead: 1_000_000,
      cacheWrite: 1_000_000,
      extendedCacheWrite: 1_000_000,
      output: 1_000_000,
    });
    expect(cost.usd).toBeCloseTo(3 + 0.3 + 3.75 + 6 + 15);
  });

  it("charges a write at the input rate when the vendor has no write price", () => {
    const free: ModelPrice = {
      ...sonnet,
      tiers: [{ ...sonnet.tiers[0]!, cacheWriteUsdPerM: null }],
    };
    const cost = priceTurn(free, { ...none, cacheWrite: 1_000_000 });
    expect(cost.usd).toBeCloseTo(3);
  });

  it("uses the higher tier once total input exceeds the threshold (S18)", () => {
    const tiered: ModelPrice = {
      ...sonnet,
      tiers: [
        { ...sonnet.tiers[0]!, maxInputTokens: 200_000 },
        { ...sonnet.tiers[0]!, inputUsdPerM: 6, outputUsdPerM: 22 },
      ],
    };
    const low = priceTurn(tiered, { ...none, uncachedInput: 200_000 });
    const high = priceTurn(tiered, { ...none, uncachedInput: 200_001 });
    expect(low.usd).toBeCloseTo(0.6);
    expect(high.usd).toBeCloseTo(1.200006);
  });

  it("prices from anything with tiers, e.g. a price-book version (step 15.6 reuses this math)", () => {
    const cost = priceTurn({ tiers: sonnet.tiers }, { ...none, output: 1_000_000 });
    expect(cost.usd).toBeCloseTo(15);
  });
});
