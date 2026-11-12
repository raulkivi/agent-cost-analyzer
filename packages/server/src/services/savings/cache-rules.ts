// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { CachingKind, VendorProfile } from "@agent-cost-analyzer/domain";
import { ReplayModelResolver } from "../session-replay/replay-model-resolver.js";
import type { CacheRules, CacheRulesLookup } from "./cache-break-classifier.js";

// Phase 16 SR4: a vendor profile's caching kind as the cache-break
// classifier's rules. Only a documented minimum and lifetime classify a
// break; best-effort and undocumented caching stay unknown with the reason
// (constraint 6), never an assumed lifetime. Model ids resolve as the
// replay's do (one resolver, not a copy).

export function cacheRulesOf(caching: CachingKind, subject: string): CacheRules {
  switch (caching.kind) {
    case "breakpoints":
      return {
        known: true,
        minCacheableTokens: caching.minCacheableTokens,
        lifetime: { minMinutes: caching.defaultTtlMinutes, maxMinutes: caching.defaultTtlMinutes },
        ...(caching.extendedTtlMinutes !== undefined ? { extendedLifetimeMinutes: caching.extendedTtlMinutes } : {}),
      };
    case "automatic-prefix": {
      const ttl = caching.ttlMinutes;
      return {
        known: true,
        minCacheableTokens: caching.minCacheableTokens,
        lifetime: "fixed" in ttl ? { minMinutes: ttl.fixed, maxMinutes: ttl.fixed } : { minMinutes: ttl.min, maxMinutes: ttl.max },
      };
    }
    case "best-effort":
      return {
        known: false,
        reason: `${subject} caches on a best-effort basis: no cache lifetime or minimum cacheable length is documented, so its cache breaks can't be classified.`,
      };
    case "unknown":
      return { known: false, reason: `${subject} documents no caching rules (${caching.reason}), so its cache breaks can't be classified.` };
  }
}

export function cacheRulesFromProfiles(profiles: readonly VendorProfile[]): CacheRulesLookup {
  const resolver = new ReplayModelResolver(profiles);
  return (model) => {
    const found = resolver.findModel(model);
    if (found === undefined) {
      return { known: false, reason: `No vendor profile lists the model ${JSON.stringify(model)}, so its caching rules are unknown.` };
    }
    return cacheRulesOf(found.model.cachingKind ?? found.profile.caching, `${found.profile.displayName}'s ${found.model.modelId}`);
  };
}
