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
});

export type TurnUsage = z.infer<typeof turnUsageSchema>;
