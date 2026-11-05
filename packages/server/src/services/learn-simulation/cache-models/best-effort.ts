import type { CachingKind } from "@agent-cost-analyzer/domain";
import type {
  CacheModel,
  CacheRequest,
  KnownCacheResult,
} from "../cache-model.js";
import { PrefixCache } from "./prefix-cache.js";

type BestEffortKind = Extract<CachingKind, { kind: "best-effort" }>;

// The vendor documents no lifetime, so the caller supplies an assumed one
// (listed in the assumptions popover) instead of this model inventing it.
export class BestEffortCacheModel implements CacheModel {
  private readonly cache: PrefixCache;

  constructor(_kind: BestEffortKind, options: { assumedTtlMinutes: number }) {
    this.cache = new PrefixCache({
      minCacheableTokens: 0,
      ttlMinutes: options.assumedTtlMinutes,
      writeCharged: false,
    });
  }

  request(req: CacheRequest): KnownCacheResult {
    return this.cache.request(req);
  }
}
