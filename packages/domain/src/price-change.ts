// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { z } from "zod";
import { isoCalendarDateSchema, precedenceClassOf, type PriceVersion } from "./price-book.js";
import type { PriceTier } from "./vendor-profile.js";
import { insightProviderStatusSchema } from "./insights.js";

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

// Phase 15 step 15.10 (plan §6.4 point 2, D11): an observed price change.
// For Copilot turns with both a billed and a priced figure in AI Credits,
// billed ÷ priced per model and ISO week; a run of at least two weeks in a
// row more than 5% away from 1, the same way, each with at least 20 such
// turns, is observed. It is evidence to check the price book against, never
// a price by itself, so it is always `inferred`.
export const OBSERVED_CHANGE_THRESHOLD = 0.05;
export const OBSERVED_CHANGE_MIN_WEEKS = 2;
export const OBSERVED_CHANGE_MIN_TURNS = 20;

export const observedWeekSchema = z.object({
  period: z.string(), // "2026-W42"
  start: isoCalendarDateSchema,
  end: isoCalendarDateSchema,
  turns: z.number().int().nonnegative(), // with both figures
  billedAiCredits: z.number().nonnegative(),
  pricedAiCredits: z.number().nonnegative(),
  ratio: z.number().nonnegative(), // billed ÷ priced
});

export const observedPriceChangeSchema = z.object({
  kind: z.literal("observed"),
  date: isoCalendarDateSchema, // the first week's Monday
  channel: z.string().min(1),
  modelId: z.string().min(1), // the model as the log names it
  direction: z.enum(["above", "below"]), // billed above or below the price book
  percent: z.number(), // (billed − priced) ÷ priced over the run, signed
  weeks: z.array(observedWeekSchema).min(OBSERVED_CHANGE_MIN_WEEKS),
  priceVersionIds: z.array(z.string()), // the versions the priced figures used
  confidence: z.literal("inferred"),
});

export const anyPriceChangeSchema = z.discriminatedUnion("kind", [priceChangeMarkerSchema, observedPriceChangeSchema]);

// get_price_changes and its HTTP twin: every change in the range, oldest
// first. `providers` is the status of the providers read for observed ones.
export const priceChangeListSchema = z.object({
  generatedAt: z.string(),
  since: isoCalendarDateSchema.optional(),
  until: isoCalendarDateSchema.optional(),
  providers: z.array(insightProviderStatusSchema),
  changes: z.array(anyPriceChangeSchema),
});

export type ObservedWeek = z.infer<typeof observedWeekSchema>;
export type ObservedPriceChange = z.infer<typeof observedPriceChangeSchema>;
export type AnyPriceChange = z.infer<typeof anyPriceChangeSchema>;
export type PriceChangeList = z.infer<typeof priceChangeListSchema>;
