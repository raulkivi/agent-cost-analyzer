import type { CacheOutcome, Layer } from "@agent-cost-analyzer/domain";
import type { Prompt } from "./prompt-builder.js";

export interface CacheRequest {
  prompt: Prompt;
  atMinute: number;
  // First layer whose content changed since the previous request.
  invalidatedFrom?: Layer;
  extendedTtl?: boolean;
}

export interface KnownCacheResult {
  cacheRead: number;
  cacheWrite: number;
  extendedCacheWrite: number;
  uncachedInput: number;
  outcome: CacheOutcome;
}

// A rule the turn depends on is unknown: counts must surface as unavailable,
// never as zeros (architecture constraint 6).
export interface UnknownCacheResult {
  outcome: "unknown";
  reason: string;
}

export type CacheResult = KnownCacheResult | UnknownCacheResult;

export interface CacheModel {
  request(req: CacheRequest): CacheResult;
}

export function isKnown(result: CacheResult): result is KnownCacheResult {
  return result.outcome !== "unknown";
}
