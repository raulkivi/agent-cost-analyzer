// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { z } from "zod";
import { insightProviderStatusSchema } from "./insights.js";
import { systemPromptComponentSchema } from "./system-prompt-component.js";
import { triggeredEventSchema } from "./turn.js";
import { costBasisTotalsSchema, costReconciliationRowSchema, costTotalSchema, turnCostFiguresSchema } from "./cost-figure.js";

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

// A session whose latest turn started this recently is flagged active: its
// log may still lack the running turn's final usage, cache writes and text
// (docs/plans/mcp-apps.md §4.7). 15 minutes covers a long agentic turn plus
// the user's think time between turns, without flagging yesterday's chats.
export const ACTIVE_SESSION_WINDOW_MINUTES = 15;

// lastTurnAt: the latest turn start the log records (absent when no turn
// has one). active: present, and true, only within the window above.
const sessionActivityShape = {
  lastTurnAt: z.string().optional(),
  active: z.boolean().optional(),
};

// Compact per-group figures (model, provider, day, session): sums over the
// group's known turns, null when none is known.
const costFiguresSchema = z.object({
  turns: z.number(),
  inputTokens: z.number().nullable(),
  output: z.number().nullable(),
  aiCredits: z.number().nullable(),
  // Step 15.6: the group's turns at their preferred cost basis (plan §5, D3),
  // per currency, with coverage.
  cost: costTotalSchema,
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
  toolCalls: z.number().nullable(), // null: tool calls unknown
  userMessage: z.string(), // bounded, redacted excerpt
  cost: turnCostFiguresSchema, // step 15.6: billed, reported and priced
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
  ...sessionActivityShape,
  turnCount: z.number(),
  // Step 15.6: the session's repository (null = Unattributed, with the
  // reason) and project (null = none); absent when attribution isn't
  // configured for the product.
  repositoryKey: z.string().nullable().optional(),
  unattributedReason: z.string().optional(),
  projectId: z.string().nullable().optional(),
  totals: costMeasuresSchema,
  // Step 15.6: the turns' cost per basis, with coverage and the price versions used.
  cost: costBasisTotalsSchema,
  cacheHitRatio: ratioSchema, // cache read / input tokens
  byModel: z.array(modelCostSchema),
  rankedBy: costRankingSchema,
  topTurns: z.array(turnCostSchema),
  events: z.array(z.object({ turnIndex: z.number(), event: triggeredEventSchema })),
  contextOverhead: contextOverheadSchema,
  unavailableReasons: z.array(z.string()),
});

export type SessionCost = z.infer<typeof sessionCostSchema>;

// Phase 12 (docs/plans/mcp-apps.md §4.2): the bounded per-turn figures a
// per-turn chart needs for one session. SessionCost carries only topTurns;
// this is the app-only `get_turn_series` result. Unknown is null, never 0.
export const turnSeriesTurnSchema = z.object({
  turnIndex: z.number(),
  startedAt: z.string().optional(), // absent when the log records no turn time
  model: z.string(),
  aiCredits: z.number().nullable(),
  inputTokens: z.number().nullable(), // uncached + cache write + cache read
  cacheRead: z.number().nullable(),
  output: z.number().nullable(),
  estimated: z.boolean(), // a figure on this turn is a local-tokenizer estimate
  events: z.array(triggeredEventSchema), // events triggered on this turn
});

export const turnSeriesSchema = z.object({
  sessionId: z.string(),
  turns: z.array(turnSeriesTurnSchema),
  totalTurns: z.number().int().nonnegative(),
  truncated: z.boolean(), // the session had more turns than maxTurns; the first maxTurns are kept
});

export type TurnSeriesTurn = z.infer<typeof turnSeriesTurnSchema>;
export type TurnSeries = z.infer<typeof turnSeriesSchema>;

// Step 15.6: one repository, project, vendor or channel in the rollup. A
// null key is the Unattributed / No project / unknown bucket, with why.
export const costGroupSchema = z.object({
  key: z.string().nullable(),
  label: z.string(),
  reason: z.string().optional(),
  turns: z.number().int().nonnegative(),
  cost: costBasisTotalsSchema,
});

export type CostGroup = z.infer<typeof costGroupSchema>;

export const costRollupSchema = z.object({
  generatedAt: z.string(),
  since: z.string().optional(),
  until: z.string().optional(),
  providers: z.array(insightProviderStatusSchema),
  sessionCount: z.number(),
  turnCount: z.number(),
  totals: costMeasuresSchema,
  cost: costBasisTotalsSchema, // step 15.6: per-basis totals with coverage
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
      ...sessionActivityShape,
    }),
  ),
  // Step 15.6: who the turns' cost belongs to and who sold it.
  byRepository: z.array(costGroupSchema),
  byProject: z.array(costGroupSchema),
  byVendor: z.array(costGroupSchema),
  byChannel: z.array(costGroupSchema),
  // Step 15.6: Copilot's billed AI Credits against the price book, per model and month.
  reconciliation: z.array(costReconciliationRowSchema),
});

export type CostRollup = z.infer<typeof costRollupSchema>;
