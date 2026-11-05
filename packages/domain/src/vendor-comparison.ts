import { z } from "zod";
import { cacheOutcomeSchema } from "./simulation.js";
import { tokenCountSchema } from "./token-count.js";
import { assumptionSchema, sourceSchema } from "./vendor-profile.js";

// What the picker and the sources footer need from a VendorProfile, without
// the invalidation rules or price tiers (listVendorProfiles, step 13.6).
export const vendorModelSummarySchema = z
  .object({
    modelId: z.string(),
    displayName: z.string(),
    simulated: z.boolean(),
    // Why a model is listed but disabled; the picker shows it verbatim.
    reason: z.string().optional(),
  })
  .refine((model) => model.simulated || (model.reason?.length ?? 0) > 0, {
    message: "a model that is not simulated needs a reason",
    path: ["reason"],
  });

export const vendorProfileSummarySchema = z.object({
  vendorId: z.string(),
  displayName: z.string(),
  defaultModelId: z.string(),
  models: z.array(vendorModelSummarySchema),
  assumptions: z.array(assumptionSchema),
  sources: z.array(sourceSchema),
  // Drives the "data is over 90 days old" warning in the sources footer.
  oldestCheckedAt: z.string(),
});

export const comparisonTurnSchema = z.object({
  index: z.number().int(),
  cacheOutcome: cacheOutcomeSchema,
  aiCredits: tokenCountSchema,
  note: z.string(),
  sourceIds: z.array(z.string()),
});

export const vendorComparisonEntrySchema = z
  .object({
    vendorId: z.string(),
    modelId: z.string(),
    displayName: z.string(),
    simulated: z.boolean(),
    reason: z.string().optional(),
    totalAiCredits: tokenCountSchema.optional(),
    turns: z.array(comparisonTurnSchema),
  })
  .refine((entry) => !entry.simulated || entry.totalAiCredits !== undefined, {
    message: "a simulated entry needs totalAiCredits",
    path: ["totalAiCredits"],
  })
  .refine((entry) => entry.simulated || (entry.reason?.length ?? 0) > 0, {
    message: "an entry that is not simulated needs a reason",
    path: ["reason"],
  });

// One scenario replayed on several models, for the "How vendors differ" card
// and the Vendors tab.
export const vendorComparisonSchema = z.object({
  scenarioId: z.string(),
  entries: z.array(vendorComparisonEntrySchema),
});

export type VendorModelSummary = z.infer<typeof vendorModelSummarySchema>;
export type VendorProfileSummary = z.infer<typeof vendorProfileSummarySchema>;
export type ComparisonTurn = z.infer<typeof comparisonTurnSchema>;
export type VendorComparisonEntry = z.infer<typeof vendorComparisonEntrySchema>;
export type VendorComparison = z.infer<typeof vendorComparisonSchema>;
