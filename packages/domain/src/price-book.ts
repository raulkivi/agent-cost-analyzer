import { z } from "zod";
import { priceTierSchema, sourceSchema, type PriceTier } from "./vendor-profile.js";

// Phase 15 step 15.5 (docs/plans/cost-by-repository-and-project.md §6): one
// model's prices on one channel over a time range. The tiers are Phase 13's
// PriceTier unchanged, so they are USD per 1M tokens; Copilot's AI Credits
// follow from them at 1 AI Credit = $0.01 (plan §5).

function isCalendarDate(value: string): boolean {
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

// An ISO calendar date (UTC), e.g. "2026-10-26".
export const isoCalendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected an ISO date (YYYY-MM-DD)")
  .refine(isCalendarDate, "Not a calendar date");

export const priceVersionKindSchema = z.enum(["list", "promo", "contract"]);

// A contract rate applies to one project or one repository; without a
// scope it applies to every turn on its channel.
export const priceVersionScopeSchema = z.union([
  z.object({ projectId: z.string().min(1) }).strict(),
  z.object({ repository: z.string().min(1) }).strict(),
]);

const priceVersionShape = {
  // "<channel>:<modelId>:<effectiveFrom>" for bundled versions.
  id: z.string().min(1),
  // "github-copilot", "anthropic-api", "openai-api", ... or a user channel id.
  channel: z.string().min(1),
  // The price table's model id (Phase 13's ids, e.g. "claude-sonnet-5.5").
  modelId: z.string().min(1),
  currency: z.literal("USD"),
  effectiveFrom: isoCalendarDateSchema, // inclusive
  effectiveTo: isoCalendarDateSchema.optional(), // exclusive; absent = still in force
  tiers: z.array(priceTierSchema).min(1),
  kind: priceVersionKindSchema,
  promoEndsAt: isoCalendarDateSchema.optional(),
  scope: priceVersionScopeSchema.optional(),
  // Bundled versions must cite at least one source (checked by the loader);
  // a user's contract version may cite none.
  sourceIds: z.array(z.string().min(1)).default([]),
  note: z.string().min(1).optional(),
};

// Same rule as Phase 13's Pricer: tiers ascend by maxInputTokens and the
// last one has none (it covers everything above).
function tiersAreOrdered(tiers: PriceTier[]): boolean {
  return tiers.every((tier, index) => {
    if (index === tiers.length - 1) return tier.maxInputTokens === undefined;
    const previous = index === 0 ? -1 : tiers[index - 1]!.maxInputTokens!;
    return tier.maxInputTokens !== undefined && tier.maxInputTokens > previous;
  });
}

type VersionFields = {
  effectiveFrom: string;
  effectiveTo?: string;
  tiers: PriceTier[];
  kind: string;
  promoEndsAt?: string;
  scope?: unknown;
};

function checkVersion(value: VersionFields, ctx: z.RefinementCtx): void {
  if (value.effectiveTo !== undefined && value.effectiveTo <= value.effectiveFrom) {
    ctx.addIssue({ code: "custom", path: ["effectiveTo"], message: "effectiveTo is exclusive and must be after effectiveFrom" });
  }
  if (!tiersAreOrdered(value.tiers)) {
    ctx.addIssue({
      code: "custom",
      path: ["tiers"],
      message: "tiers must ascend by maxInputTokens, and only the last may omit it",
    });
  }
  if ((value.kind === "promo") !== (value.promoEndsAt !== undefined)) {
    ctx.addIssue({ code: "custom", path: ["promoEndsAt"], message: "promoEndsAt is required on promo versions and only allowed there" });
  }
  if (value.scope !== undefined && value.kind !== "contract") {
    ctx.addIssue({ code: "custom", path: ["scope"], message: "only contract versions can be scoped" });
  }
}

export const priceVersionSchema = z.object(priceVersionShape).superRefine(checkVersion);

// Where a version came from: the app's bundled price book or the user's
// projects file (channels.priceVersions).
export const priceVersionOriginSchema = z.enum(["bundled", "user"]);

export const priceBookEntrySchema = z
  .object({ ...priceVersionShape, origin: priceVersionOriginSchema })
  .superRefine(checkVersion);

// A bundled channel file, fixtures/price-book/<channel>.json: the sources
// its versions cite (each with checkedAt) and the versions themselves.
export const priceBookChannelFileSchema = z.object({
  channel: z.string().min(1),
  sources: z.array(sourceSchema),
  versions: z.array(priceVersionSchema),
});

export const priceLookupSchema = z.discriminatedUnion("known", [
  z.object({ known: z.literal(true), version: priceBookEntrySchema }),
  z.object({ known: z.literal(false), reason: z.string().min(1) }),
]);

// A range of time with no version of a model on a channel: allowed, but
// flagged (plan §6.1), since a turn in it prices as unknown.
export const priceGapSchema = z.object({
  channel: z.string(),
  modelId: z.string(),
  from: isoCalendarDateSchema,
  to: isoCalendarDateSchema,
});

export const priceBookProblemSchema = z.object({
  path: z.string(),
  message: z.string(),
});

// What get_price_book and GET /api/price-book return.
export const priceBookListingSchema = z.object({
  channels: z.array(z.string()),
  versions: z.array(priceBookEntrySchema),
  // Every source the listed versions cite.
  sources: z.array(sourceSchema),
  gaps: z.array(priceGapSchema),
  // A channel/model asked for (or, with `at`, matched) with no version in force.
  unknown: z.array(z.object({ channel: z.string(), modelId: z.string(), reason: z.string().min(1) })),
  // User versions left out of the book, and why.
  problems: z.array(priceBookProblemSchema),
});

export type PriceVersionKind = z.infer<typeof priceVersionKindSchema>;
export type PriceVersionScope = z.infer<typeof priceVersionScopeSchema>;
export type PriceVersion = z.infer<typeof priceVersionSchema>;
export type PriceVersionOrigin = z.infer<typeof priceVersionOriginSchema>;
export type PriceBookEntry = z.infer<typeof priceBookEntrySchema>;
export type PriceBookChannelFile = z.infer<typeof priceBookChannelFileSchema>;
export type PriceLookup = z.infer<typeof priceLookupSchema>;
export type PriceGap = z.infer<typeof priceGapSchema>;
export type PriceBookProblem = z.infer<typeof priceBookProblemSchema>;
export type PriceBookListing = z.infer<typeof priceBookListingSchema>;

// Versions compete only within one precedence class: the vendor's own
// prices (list and promo) form one, each contract scope another.
export function precedenceClassOf(version: Pick<PriceVersion, "kind" | "scope">): string {
  if (version.kind !== "contract") return "list";
  if (version.scope === undefined) return "contract";
  return "projectId" in version.scope ? `contract:project:${version.scope.projectId}` : `contract:repository:${version.scope.repository}`;
}

type ConflictInput = Pick<PriceVersion, "id" | "channel" | "modelId" | "kind" | "scope" | "effectiveFrom" | "effectiveTo">;

export interface PriceVersionConflicts {
  overlaps: { first: string; second: string }[];
  gaps: PriceGap[];
}

// Overlaps (rejected) and gaps (flagged) between versions of one model on
// one channel in one precedence class. Ranges are [effectiveFrom, effectiveTo).
export function findPriceVersionConflicts(versions: readonly ConflictInput[]): PriceVersionConflicts {
  const groups = new Map<string, ConflictInput[]>();
  for (const version of versions) {
    const key = JSON.stringify([version.channel, version.modelId, precedenceClassOf(version)]);
    groups.set(key, [...(groups.get(key) ?? []), version]);
  }
  const conflicts: PriceVersionConflicts = { overlaps: [], gaps: [] };
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.id.localeCompare(b.id));
    // The latest end seen so far, so a long version overlapping two later
    // ones is caught for both; undefined = open-ended.
    let reach: { end: string | undefined; id: string } | undefined;
    for (const version of sorted) {
      if (reach !== undefined) {
        if (reach.end === undefined || reach.end > version.effectiveFrom) {
          conflicts.overlaps.push({ first: reach.id, second: version.id });
        } else if (reach.end < version.effectiveFrom) {
          conflicts.gaps.push({ channel: version.channel, modelId: version.modelId, from: reach.end, to: version.effectiveFrom });
        }
      }
      const end = version.effectiveTo;
      if (reach === undefined || (reach.end !== undefined && (end === undefined || end > reach.end))) {
        reach = { end, id: version.id };
      }
    }
  }
  return conflicts;
}
