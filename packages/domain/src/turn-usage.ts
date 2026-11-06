import { z } from "zod";
import { tokenCountSchema } from "./token-count.js";

export const turnUsageSchema = z.object({
  uncachedInput: tokenCountSchema,
  cacheWrite: tokenCountSchema,
  cacheRead: tokenCountSchema,
  tool: tokenCountSchema,
  vision: tokenCountSchema,
  reasoning: tokenCountSchema,
  output: tokenCountSchema,
  costAiCredits: tokenCountSchema,
  model: z.string(),
  // How many LLM request/response round-trips this turn made — a plain
  // count rather than TokenCount since a missing value just means "not
  // computed by this source" (e.g. Learn-mode fixtures), not a specific
  // unavailability reason worth surfacing.
  roundsCount: z.number().optional(),
  // Phase 15 step 15.6: the part of cacheWrite written with the extended
  // (Anthropic: 1-hour) lifetime, which is priced higher. Absent: the
  // provider doesn't record the split, and the pricer applies the
  // provider's default lifetime (docs/plans/cost-by-repository-and-project.md §14.1, 15.6).
  extendedCacheWrite: tokenCountSchema.optional(),
  // Phase 15 step 15.6: the cost the agent computed and logged itself, in
  // USD (pi's Usage.cost.total): the "reported" cost basis. Absent: the
  // provider logs no cost of its own.
  reportedCostUsd: tokenCountSchema.optional(),
});

export type TurnUsage = z.infer<typeof turnUsageSchema>;
