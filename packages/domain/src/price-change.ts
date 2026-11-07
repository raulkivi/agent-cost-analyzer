// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { z } from "zod";
import { isoCalendarDateSchema, precedenceClassOf, type PriceVersion } from "./price-book.js";
import type { PriceTier } from "./vendor-profile.js";

// Phase 15 step 15.7 (docs/plans/cost-by-repository-and-project.md §6.4
// point 1, §10.1.1): a documented price change is the boundary between two
// adjacent price versions of one model on one channel (in one precedence
// class), where a unit price differs. Cost series carry these as markers in
// their range. Step 15.10's PriceChangeDetector builds on the same function
// and adds observed changes.

export const priceTokenTypeSchema = z.enum(["input", "cachedInput", "cacheWrite", "extendedCacheWrite", "output"]);
export type PriceTokenType = z.infer<typeof priceTokenTypeSchema>;

export const priceChangeSchema = z.object({
  tier: z.number().int().nonnegative(), // index into the versions' tiers
  tokenType: priceTokenTypeSchema,
  // USD per 1M tokens; null where the version has no such price.
  fromUsdPerM: z.number().nonnegative().nullable(),
  toUsdPerM: z.number().nonnegative().nullable(),
  percent: z.number().nullable(), // null when either side is null or the old price is 0
});

export const priceChangeMarkerSchema = z.object({
  kind: z.literal("documented"),
  date: isoCalendarDateSchema, // the new version's effectiveFrom (00:00 UTC)
  channel: z.string().min(1),
  modelId: z.string().min(1),
  fromVersionId: z.string().min(1),
  toVersionId: z.string().min(1),
  changes: z.array(priceChangeSchema).min(1),
  sourceIds: z.array(z.string()), // the new version's sources
  note: z.string().optional(),
});

export type PriceChange = z.infer<typeof priceChangeSchema>;
export type PriceChangeMarker = z.infer<typeof priceChangeMarkerSchema>;

type MarkerInput = Pick<PriceVersion, "id" | "channel" | "modelId" | "kind" | "scope" | "effectiveFrom" | "effectiveTo" | "tiers" | "sourceIds" | "note">;

export interface PriceChangeRange {
  since?: string; // inclusive ISO date
  until?: string; // inclusive ISO date
  // Only these channel/model pairs; absent = every pair.
  pairs?: readonly { channel: string; modelId: string }[];
}

const FIELDS: readonly [PriceTokenType, keyof PriceTier][] = [
  ["input", "inputUsdPerM"],
  ["cachedInput", "cachedInputUsdPerM"],
  ["cacheWrite", "cacheWriteUsdPerM"],
  ["extendedCacheWrite", "extendedCacheWriteUsdPerM"],
  ["output", "outputUsdPerM"],
];

const priceOf = (tier: PriceTier | undefined, field: keyof PriceTier): number | null => {
  const value = tier?.[field];
  return typeof value === "number" ? value : null;
};

function changesBetween(from: MarkerInput, to: MarkerInput): PriceChange[] {
  const changes: PriceChange[] = [];
  const tiers = Math.max(from.tiers.length, to.tiers.length);
  for (let tier = 0; tier < tiers; tier += 1) {
    for (const [tokenType, field] of FIELDS) {
      const fromUsdPerM = priceOf(from.tiers[tier], field);
      const toUsdPerM = priceOf(to.tiers[tier], field);
      if (fromUsdPerM === toUsdPerM) continue;
      const percent = fromUsdPerM === null || toUsdPerM === null || fromUsdPerM === 0 ? null : Math.round(((toUsdPerM - fromUsdPerM) / fromUsdPerM) * 10000) / 100;
      changes.push({ tier, tokenType, fromUsdPerM, toUsdPerM, percent });
    }
  }
  return changes;
}

export function documentedPriceChanges(versions: readonly MarkerInput[], range: PriceChangeRange = {}): PriceChangeMarker[] {
  const wanted = range.pairs ? new Set(range.pairs.map((pair) => JSON.stringify([pair.channel, pair.modelId]))) : undefined;
  const groups = new Map<string, MarkerInput[]>();
  for (const version of versions) {
    if (wanted && !wanted.has(JSON.stringify([version.channel, version.modelId]))) continue;
    const key = JSON.stringify([version.channel, version.modelId, precedenceClassOf(version)]);
    groups.set(key, [...(groups.get(key) ?? []), version]);
  }
  const markers: PriceChangeMarker[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.id.localeCompare(b.id));
    for (let index = 1; index < sorted.length; index += 1) {
      const from = sorted[index - 1]!;
      const to = sorted[index]!;
      if (from.effectiveTo !== to.effectiveFrom) continue; // a gap or an overlap, not a change
      if ((range.since !== undefined && to.effectiveFrom < range.since) || (range.until !== undefined && to.effectiveFrom > range.until)) continue;
      const changes = changesBetween(from, to);
      if (changes.length === 0) continue;
      markers.push({
        kind: "documented",
        date: to.effectiveFrom,
        channel: to.channel,
        modelId: to.modelId,
        fromVersionId: from.id,
        toVersionId: to.id,
        changes,
        sourceIds: [...to.sourceIds],
        ...(to.note !== undefined ? { note: to.note } : {}),
      });
    }
  }
  return markers.sort((a, b) => a.date.localeCompare(b.date) || a.channel.localeCompare(b.channel) || a.modelId.localeCompare(b.modelId));
}
