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
function pickTier(tiers: PriceTier[], inputTokens: number): PriceTier {
  return (
    tiers.find(
      (tier) =>
        tier.maxInputTokens === undefined || inputTokens <= tier.maxInputTokens,
    ) ?? tiers[tiers.length - 1]!
  );
}

export function priceTurn(model: ModelPrice, usage: PricedUsage): TurnCost {
  const inputTokens =
    usage.uncachedInput +
    usage.cacheRead +
    usage.cacheWrite +
    usage.extendedCacheWrite;
  const tier = pickTier(model.tiers, inputTokens);
  // No published write price means writes are billed like plain input.
  const writeRate = tier.cacheWriteUsdPerM ?? tier.inputUsdPerM;
  const extendedRate = tier.extendedCacheWriteUsdPerM ?? writeRate;
  const usd =
    (usage.uncachedInput * tier.inputUsdPerM +
      usage.cacheRead * tier.cachedInputUsdPerM +
      usage.cacheWrite * writeRate +
      usage.extendedCacheWrite * extendedRate +
      usage.output * tier.outputUsdPerM) /
    1_000_000;
  return { usd, aiCredits: usd / USD_PER_AI_CREDIT };
}
