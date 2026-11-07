// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { CachingKind } from "@agent-cost-analyzer/domain";
import type {
  CacheModel,
  CacheRequest,
  KnownCacheResult,
} from "../cache-model.js";
import { PrefixCache } from "./prefix-cache.js";

type AutomaticPrefixKind = Extract<CachingKind, { kind: "automatic-prefix" }>;

// A {min,max} lifetime is a range the vendor doesn't pin down, so expiry
// uses the guaranteed minimum to avoid promising hits that may not happen.
function ttlOf(kind: AutomaticPrefixKind): number {
  return "fixed" in kind.ttlMinutes
    ? kind.ttlMinutes.fixed
    : kind.ttlMinutes.min;
}

export class AutomaticPrefixCacheModel implements CacheModel {
  private readonly cache: PrefixCache;

  constructor(kind: AutomaticPrefixKind) {
    this.cache = new PrefixCache({
      minCacheableTokens: kind.minCacheableTokens,
      incrementTokens: kind.incrementTokens,
      ttlMinutes: ttlOf(kind),
      writeCharged: kind.writeCharged,
    });
  }

  request(req: CacheRequest): KnownCacheResult {
    return this.cache.request(req);
  }
}
