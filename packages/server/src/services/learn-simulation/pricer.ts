// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
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
export function priceTurn(model: Pick<ModelPrice, "tiers">, usage: PricedUsage): TurnCost {
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
