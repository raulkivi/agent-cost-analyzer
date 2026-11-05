import type { CacheOutcome, CachingKind } from "@agent-cost-analyzer/domain";
import type { Prompt } from "../prompt-builder.js";
import type {
  CacheModel,
  CacheRequest,
  KnownCacheResult,
} from "../cache-model.js";

type BreakpointKind = Extract<CachingKind, { kind: "breakpoints" }>;

interface Entry {
  tokens: number;
  expiresAt: number;
  ttl: number;
}

// Anthropic-style explicit breakpoints (S3-S6): a request reads the longest
// still-valid cached prefix, writes up to its last cacheable breakpoint and
// leaves the remainder uncached.
export class BreakpointCacheModel implements CacheModel {
  private entry: Entry | undefined;

  constructor(private readonly kind: BreakpointKind) {}

  request(req: CacheRequest): KnownCacheResult {
    const { prompt } = req;
    const total = prompt.totalTokens;
    const cacheable = this.lastCacheablePrefix(prompt);

    const previous =
      this.entry !== undefined && req.atMinute <= this.entry.expiresAt
        ? this.entry
        : undefined;
    const validPrefix =
      req.invalidatedFrom === undefined
        ? Infinity
        : prompt.tokensBefore(req.invalidatedFrom);
    const read = Math.min(previous?.tokens ?? 0, validPrefix, cacheable);
    const written = cacheable - read;

    const extended =
      req.extendedTtl === true && this.kind.extendedTtlMinutes !== undefined;
    const ttl = extended
      ? this.kind.extendedTtlMinutes!
      : read > 0 && written === 0 && previous !== undefined
        ? previous.ttl
        : this.kind.defaultTtlMinutes;

    if (cacheable === 0) {
      this.entry = undefined;
    } else if (read > 0 && previous !== undefined && !this.kind.refreshOnHit) {
      this.entry = { tokens: cacheable, expiresAt: previous.expiresAt, ttl };
    } else {
      this.entry = { tokens: cacheable, expiresAt: req.atMinute + ttl, ttl };
    }

    return {
      cacheRead: read,
      cacheWrite: extended ? 0 : written,
      extendedCacheWrite: extended ? written : 0,
      uncachedInput: total - cacheable,
      outcome: outcomeOf(read, previous?.tokens ?? 0),
    };
  }

  // Breakpoints sit at the end of each configured layer; only prefixes of at
  // least minCacheableTokens are cached, silently (S6).
  private lastCacheablePrefix(prompt: Prompt): number {
    let best = 0;
    for (const segment of prompt.segments) {
      if (!this.kind.layers.includes(segment.layer)) continue;
      if (segment.end > best && segment.end >= this.kind.minCacheableTokens) {
        best = segment.end;
      }
    }
    return best;
  }
}

function outcomeOf(read: number, previouslyCached: number): CacheOutcome {
  if (read === 0) return "miss";
  return read >= previouslyCached ? "hit" : "partial";
}
