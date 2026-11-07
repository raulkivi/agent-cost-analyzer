// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { CachingKind } from "@agent-cost-analyzer/domain";
import type { CacheModel, UnknownCacheResult } from "../cache-model.js";

type UnknownKind = Extract<CachingKind, { kind: "unknown" }>;

export class UnknownCacheModel implements CacheModel {
  constructor(private readonly kind: UnknownKind) {}

  request(): UnknownCacheResult {
    return { outcome: "unknown", reason: this.kind.reason };
  }
}
