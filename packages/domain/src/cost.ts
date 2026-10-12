import { z } from "zod";
import { insightProviderStatusSchema } from "./insights.js";
import { systemPromptComponentSchema } from "./system-prompt-component.js";
import { triggeredEventSchema } from "./turn.js";

// Phase 9.12 (docs/plans/mcp-tools-v2.md §4.1): token and AI Credits
// figures aggregated per session and across sessions. Unknown is null,
// never 0 (constraint 6); every total carries its turn coverage.

export const measureTotalSchema = z
  .object({
    value: z.number().nullable(), // sum over known turns; null when none is known
    knownTurns: z.number().int().nonnegative(),
    turns: z.number().int().nonnegative(),
    estimated: z.boolean(), // a contributing turn has a local-tokenizer estimate
  })
  .refine((total) => total.knownTurns <= total.turns, { message: "knownTurns cannot exceed turns", path: ["knownTurns"] });

export type MeasureTotal = z.infer<typeof measureTotalSchema>;

export const costMeasuresSchema = z.object({
  uncachedInput: measureTotalSchema,
  cacheWrite: measureTotalSchema,
  cacheRead: measureTotalSchema,
  inputTokens: measureTotalSchema, // uncached + cache write + cache read, per turn where all three are known
  reasoning: measureTotalSchema,
  output: measureTotalSchema,
  aiCredits: measureTotalSchema,
});

export type CostMeasures = z.infer<typeof costMeasuresSchema>;

const ratioSchema = z.number().min(0).max(1).nullable();

// Compact per-group figures (model, provider, day, session): sums over the
// group's known turns, null when none is known.
const costFiguresSchema = z.object({
  turns: z.number(),
  inputTokens: z.number().nullable(),
  output: z.number().nullable(),
  aiCredits: z.number().nullable(),
});

export type CostFigures = z.infer<typeof costFiguresSchema>;

export const costRankingSchema = z.enum(["aiCredits", "inputTokens"]);
export type CostRanking = z.infer<typeof costRankingSchema>;

export const modelCostSchema = costFiguresSchema.extend({ model: z.string() });

export const turnCostSchema = z.object({
  turnIndex: z.number(),
  model: z.string(),
  triggeredEvent: triggeredEventSchema.optional(),
  inputTokens: z.number().nullable(),
  output: z.number().nullable(),
  aiCredits: z.number().nullable(),
  toolCalls: z.number(),
  userMessage: z.string(), // bounded, redacted excerpt
});

export const contextOverheadSchema = z.object({
  systemPrompt: z
    .object({
      tokens: z.number().nullable(),
      components: z.array(systemPromptComponentSchema.pick({ kind: true, label: true }).extend({ tokens: z.number().nullable() })),
    })
    .optional(),
  toolInventory: z
    .object({
      defined: z.number(),
      loaded: z.number(),
      invoked: z.number(),
      neverInvokedCount: z.number(),
      neverInvoked: z.array(z.string()), // bounded list
    })
    .optional(),
  unavailableReason: z.string().optional(),
});

export const sessionCostSchema = z.object({
  sessionId: z.string(),
  providerId: z.string().optional(),
  title: z.string(),
  model: z.string(),
  startedAt: z.string().optional(),
  turnCount: z.number(),
  totals: costMeasuresSchema,
  cacheHitRatio: ratioSchema, // cache read / input tokens
  byModel: z.array(modelCostSchema),
  rankedBy: costRankingSchema,
  topTurns: z.array(turnCostSchema),
  events: z.array(z.object({ turnIndex: z.number(), event: triggeredEventSchema })),
  contextOverhead: contextOverheadSchema,
  unavailableReasons: z.array(z.string()),
});

export type SessionCost = z.infer<typeof sessionCostSchema>;

export const costRollupSchema = z.object({
  generatedAt: z.string(),
  since: z.string().optional(),
  until: z.string().optional(),
  providers: z.array(insightProviderStatusSchema),
  sessionCount: z.number(),
  turnCount: z.number(),
  totals: costMeasuresSchema,
  cacheHitRatio: ratioSchema,
  byProvider: z.array(costFiguresSchema.extend({ providerId: z.string(), providerLabel: z.string(), sessions: z.number() })),
  byModel: z.array(modelCostSchema),
  daily: z.array(costFiguresSchema.extend({ date: z.string(), sessions: z.number() })),
  rankedBy: costRankingSchema,
  topSessions: z.array(
    costFiguresSchema.extend({
      providerId: z.string(),
      sessionId: z.string(),
      title: z.string(),
      model: z.string(),
      startedAt: z.string().optional(),
    }),
  ),
});

export type CostRollup = z.infer<typeof costRollupSchema>;
