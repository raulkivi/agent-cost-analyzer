import type { ModelPrice, PriceTier } from "@agent-cost-analyzer/domain";

export interface PricedUsage {
  uncachedInput: number;
  cacheRead: number;
  cacheWrite: number;
  extendedCacheWrite: number;
  output: number; // includes reasoning tokens, billed as output
}

export interface TurnCost {
  usd: number;
  aiCredits: number;
}

const USD_PER_AI_CREDIT = 0.01;

// Tiers are ordered by ascending threshold; the last has no maxInputTokens.
// The tier applies per request by its whole prompt (Phase 15's CostPricer
// picks it the same way).
export function pickTier(tiers: PriceTier[], inputTokens: number): PriceTier {
  return (
    tiers.find(
      (tier) =>
        tier.maxInputTokens === undefined || inputTokens <= tier.maxInputTokens,
    ) ?? tiers[tiers.length - 1]!
  );
}

// Only the tiers are read, so a Phase 15 price-book version prices the same way.
// The USD per token type a turn costs (Phase 15 step 15.10: the variance
// needs each type's cost); cache writes of both lifetimes are one type.
export interface TurnCostParts {
  uncachedInput: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

// The tier and per-type rates (USD per 1M) a turn is priced at.
function ratesFor(model: Pick<ModelPrice, "tiers">, usage: PricedUsage) {
  const inputTokens =
    usage.uncachedInput +
    usage.cacheRead +
    usage.cacheWrite +
    usage.extendedCacheWrite;
  const tier = pickTier(model.tiers, inputTokens);
  // No published write price means writes are billed like plain input.
  const writeRate = tier.cacheWriteUsdPerM ?? tier.inputUsdPerM;
  const extendedRate = tier.extendedCacheWriteUsdPerM ?? writeRate;
  return { tier, writeRate, extendedRate };
}

export function priceTurnParts(model: Pick<ModelPrice, "tiers">, usage: PricedUsage): TurnCostParts {
  const { tier, writeRate, extendedRate } = ratesFor(model, usage);
  return {
    uncachedInput: (usage.uncachedInput * tier.inputUsdPerM) / 1_000_000,
    cacheRead: (usage.cacheRead * tier.cachedInputUsdPerM) / 1_000_000,
    cacheWrite: (usage.cacheWrite * writeRate + usage.extendedCacheWrite * extendedRate) / 1_000_000,
    output: (usage.output * tier.outputUsdPerM) / 1_000_000,
  };
}

export function priceTurn(model: Pick<ModelPrice, "tiers">, usage: PricedUsage): TurnCost {
  const { tier, writeRate, extendedRate } = ratesFor(model, usage);
  const usd =
    (usage.uncachedInput * tier.inputUsdPerM +
      usage.cacheRead * tier.cachedInputUsdPerM +
      usage.cacheWrite * writeRate +
      usage.extendedCacheWrite * extendedRate +
      usage.output * tier.outputUsdPerM) /
    1_000_000;
  return { usd, aiCredits: usd / USD_PER_AI_CREDIT };
}
