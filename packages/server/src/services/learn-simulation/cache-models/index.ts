import type { CachingKind } from "@agent-cost-analyzer/domain";
import type { CacheModel } from "../cache-model.js";
import { AutomaticPrefixCacheModel } from "./automatic-prefix.js";
import { BestEffortCacheModel } from "./best-effort.js";
import { BreakpointCacheModel } from "./breakpoint.js";
import { UnknownCacheModel } from "./unknown.js";

export interface CacheModelOptions {
  assumedTtlMinutes?: number;
}

export function createCacheModel(
  kind: CachingKind,
  options: CacheModelOptions = {},
): CacheModel {
  switch (kind.kind) {
    case "breakpoints":
      return new BreakpointCacheModel(kind);
    case "automatic-prefix":
      return new AutomaticPrefixCacheModel(kind);
    case "best-effort":
      if (options.assumedTtlMinutes === undefined) {
        throw new Error("best-effort caching needs assumedTtlMinutes");
      }
      return new BestEffortCacheModel(kind, {
        assumedTtlMinutes: options.assumedTtlMinutes,
      });
    case "unknown":
      return new UnknownCacheModel(kind);
  }
}
