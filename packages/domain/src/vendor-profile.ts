import { z } from "zod";

export const layerSchema = z.enum(["tools", "system", "messages"]);
export const harnessSchema = z.enum([
  "vscode-local",
  "copilot-agent-host",
  "claude-code",
]);
export const confidenceSchema = z.enum(["documented", "inferred", "unknown"]);

// Only the changes a vendor's invalidation table can key on; script events
// like compaction or clear are handled by simulation rules, not profile data.
export const changeKindSchema = z.enum([
  "tools-changed",
  "system-changed",
  "image-added",
  "image-removed",
  "thinking-changed",
  "model-switch",
  "tool-choice-changed",
]);

export const sourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  quote: z.string().optional(),
  checkedAt: z.string(),
});

const tokens = z.number().int().nonnegative();
const minutes = z.number().positive();

export const cachingKindSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("breakpoints"),
    defaultTtlMinutes: minutes,
    extendedTtlMinutes: minutes.optional(),
    refreshOnHit: z.boolean(),
    minCacheableTokens: tokens,
    layers: z.array(layerSchema),
  }),
  z.object({
    kind: z.literal("automatic-prefix"),
    ttlMinutes: z.union([
      z.object({ min: minutes, max: minutes }).strict(),
      z.object({ fixed: minutes }).strict(),
    ]),
    writeCharged: z.boolean(),
    minCacheableTokens: tokens,
    incrementTokens: tokens.optional(),
  }),
  z.object({ kind: z.literal("best-effort"), note: z.string() }),
  z.object({ kind: z.literal("unknown"), reason: z.string().min(1) }),
]);

// A source-less "documented" claim is unverifiable, and an "unknown" one
// citing sources contradicts itself (constraint 6: never imply certainty).
export function confidenceMatchesSources(value: {
  confidence: string;
  sourceIds?: string[];
}): boolean {
  const count = value.sourceIds?.length ?? 0;
  if (value.confidence === "documented") return count > 0;
  if (value.confidence === "unknown") return count === 0;
  return true;
}
export const confidenceMessage =
  "documented needs sourceIds; unknown must not carry them";

export const invalidationRuleSchema = z
  .object({
    change: changeKindSchema,
    invalidatesFrom: z.union([
      layerSchema,
      z.literal("nothing"),
      z.literal("unknown"),
    ]),
    modelSpecific: z.boolean().optional(),
    confidence: confidenceSchema,
    sourceIds: z.array(z.string()).default([]),
  })
  .refine(confidenceMatchesSources, {
    message: confidenceMessage,
    path: ["sourceIds"],
  });

export const priceTierSchema = z.object({
  maxInputTokens: tokens.optional(),
  inputUsdPerM: z.number().nonnegative(),
  cachedInputUsdPerM: z.number().nonnegative(),
  cacheWriteUsdPerM: z.number().nonnegative().nullable(),
  extendedCacheWriteUsdPerM: z.number().nonnegative().optional(),
  outputUsdPerM: z.number().nonnegative(),
});

export const modelPriceSchema = z.object({
  modelId: z.string(),
  displayName: z.string(),
  vendorId: z.string(),
  releaseStatus: z.string(),
  tiers: z.array(priceTierSchema).min(1),
  cachingKind: cachingKindSchema.optional(),
  cheaperSiblingId: z.string().optional(),
  promoEndsAt: z.string().optional(),
  sourceIds: z.array(z.string()),
});

export const assumptionSchema = z
  .object({
    text: z.string(),
    confidence: confidenceSchema,
    sourceIds: z.array(z.string()).optional(),
  })
  .refine(confidenceMatchesSources, {
    message: confidenceMessage,
    path: ["sourceIds"],
  });

export const vendorProfileSchema = z.object({
  vendorId: z.string(),
  displayName: z.string(),
  defaultModelId: z.string(),
  caching: cachingKindSchema,
  invalidation: z.array(invalidationRuleSchema),
  models: z.array(modelPriceSchema),
  assumptions: z.array(assumptionSchema),
  sources: z.array(sourceSchema),
});

export type Layer = z.infer<typeof layerSchema>;
export type Harness = z.infer<typeof harnessSchema>;
export type Confidence = z.infer<typeof confidenceSchema>;
export type ChangeKind = z.infer<typeof changeKindSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type CachingKind = z.infer<typeof cachingKindSchema>;
export type InvalidationRule = z.infer<typeof invalidationRuleSchema>;
export type PriceTier = z.infer<typeof priceTierSchema>;
export type ModelPrice = z.infer<typeof modelPriceSchema>;
export type Assumption = z.infer<typeof assumptionSchema>;
export type VendorProfile = z.infer<typeof vendorProfileSchema>;
