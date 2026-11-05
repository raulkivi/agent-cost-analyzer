import type { CacheOutcome, Layer } from "@agent-cost-analyzer/domain";
import type { Prompt } from "./prompt-builder.js";

export interface CacheRequest {
  prompt: Prompt;
  atMinute: number;
  // First layer whose content changed since the previous request.
  invalidatedFrom?: Layer;
  extendedTtl?: boolean;
  // Length of the prompt prefix still identical to the previous request's,
  // for rewind and fork where the shared part ends mid-layer (S15).
  sharedPrefixTokens?: number;
}

// Tokens at the start of the prompt that can still be read from the cache.
export function validPrefixTokens(req: CacheRequest): number {
  const byLayer =
    req.invalidatedFrom === undefined
      ? Infinity
      : req.prompt.tokensBefore(req.invalidatedFrom);
  return Math.min(byLayer, req.sharedPrefixTokens ?? Infinity);
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
