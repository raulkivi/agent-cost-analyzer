import type { CacheOutcome } from "@agent-cost-analyzer/domain";
import {
  validPrefixTokens,
  type CacheRequest,
  type KnownCacheResult,
} from "../cache-model.js";

export interface PrefixCacheConfig {
  minCacheableTokens: number;
  incrementTokens?: number;
  ttlMinutes: number;
  writeCharged: boolean;
}

interface Entry {
  tokens: number;
  expiresAt: number;
}

// Implicit prefix caching (S7, S17): the provider matches the longest cached
// prefix on its own, so there are no breakpoints to place. Shared by the
// documented automatic-prefix kind and the assumed best-effort kind.
export class PrefixCache {
  private entry: Entry | undefined;

  constructor(private readonly config: PrefixCacheConfig) {}

  request(req: CacheRequest): KnownCacheResult {
    const total = req.prompt.totalTokens;
    const cacheable = this.align(total);
    const cacheableTokens =
      cacheable >= this.config.minCacheableTokens ? cacheable : 0;

    const previous =
      this.entry !== undefined && req.atMinute <= this.entry.expiresAt
        ? this.entry.tokens
        : 0;
    const limit = validPrefixTokens(req);
    const validPrefix = Number.isFinite(limit) ? this.align(limit) : limit;
    const read = Math.min(previous, validPrefix, cacheableTokens);
    const written = cacheableTokens - read;

    // A hit refreshes the lifetime, like a fresh write does.
    this.entry =
      cacheableTokens === 0
        ? undefined
        : {
            tokens: cacheableTokens,
            expiresAt: req.atMinute + this.config.ttlMinutes,
          };

    const charged = this.config.writeCharged;
    return {
      cacheRead: read,
      cacheWrite: charged ? written : 0,
      extendedCacheWrite: 0,
      // Uncharged writes are billed as plain input.
      uncachedInput: total - read - (charged ? written : 0),
      outcome: outcomeOf(read, previous),
    };
  }

  private align(tokens: number): number {
    const step = this.config.incrementTokens;
    return step === undefined ? tokens : Math.floor(tokens / step) * step;
  }
}

function outcomeOf(read: number, previouslyCached: number): CacheOutcome {
  if (read === 0) return "miss";
  return read >= previouslyCached ? "hit" : "partial";
}
