import { z } from "zod";
import { failureCategorySchema, toolCallStatusSchema } from "./tool-call-outcome.js";
import { toolKindSchema } from "./tool-call-record.js";
import { triggeredEventSchema } from "./turn.js";

// Phase 9.11 insights dashboard (docs/plans/insights-dashboard.md §3): a
// small star schema of flat, already-redacted rows across every provider.
// The browser's associative engine links them by key: sessions ← turns ←
// toolCalls, and sessions ← findings.

// null = unknown (constraint 6) — never 0, never omitted.
const tokenFigureSchema = z.number().nullable();

export const insightSessionRowSchema = z.object({
  key: z.string(), // providerId:sessionId
  providerId: z.string(),
  providerLabel: z.string(),
  sessionId: z.string(),
  title: z.string(),
  model: z.string(),
  startedAt: z.string().optional(),
  date: z.string().optional(), // YYYY-MM-DD (UTC) from startedAt
  hour: z.number().int().min(0).max(23).optional(), // UTC hour from startedAt
});

export type InsightSessionRow = z.infer<typeof insightSessionRowSchema>;

export const insightTurnRowSchema = z.object({
  key: z.string(),
  sessionKey: z.string(),
  turnIndex: z.number(),
  model: z.string(),
  triggeredEvent: triggeredEventSchema.optional(),
  uncachedInput: tokenFigureSchema,
  cacheWrite: tokenFigureSchema,
  cacheRead: tokenFigureSchema,
  reasoning: tokenFigureSchema,
  output: tokenFigureSchema,
  aiCredits: tokenFigureSchema,
  estimated: z.boolean(), // any figure on this turn is a local-tokenizer estimate
  toolCallCount: z.number(),
});

export type InsightTurnRow = z.infer<typeof insightTurnRowSchema>;

export const insightToolCallRowSchema = z.object({
  key: z.string(),
  turnKey: z.string(),
  name: z.string(),
  kind: toolKindSchema,
  program: z.string().optional(),
  status: toolCallStatusSchema,
  failureCategory: failureCategorySchema.optional(),
  command: z.string().optional(), // bounded + redacted server-side
  startedAt: z.string().optional(),
  durationMs: z.number().optional(),
});

export type InsightToolCallRow = z.infer<typeof insightToolCallRowSchema>;

export const findingKindSchema = z.enum(["security", "anomaly", "behavior-change"]);
export type FindingKind = z.infer<typeof findingKindSchema>;

export const findingSeveritySchema = z.enum(["info", "low", "medium", "high", "critical"]);
export type FindingSeverity = z.infer<typeof findingSeveritySchema>;

export const insightFindingSchema = z.object({
  key: z.string(),
  sessionKey: z.string(),
  turnIndex: z.number().optional(),
  toolCallKey: z.string().optional(),
  kind: findingKindSchema,
  category: z.string(), // detector-specific, e.g. "credential-access", "cost-outlier"
  severity: findingSeveritySchema,
  ruleId: z.string(),
  title: z.string(), // what happened
  at: z.string().optional(), // when (call timestamp, else session start)
  why: z.string(), // why it was flagged
  evidence: z.string().optional(), // redacted excerpt
});

export type InsightFinding = z.infer<typeof insightFindingSchema>;

export const insightProviderStatusSchema = z.object({
  id: z.string(),
  label: z.string(),
  available: z.boolean(),
  unavailableReason: z.string().optional(),
  sessionCount: z.number(),
  truncated: z.boolean(), // more sessions matched than the per-provider limit
  error: z.string().optional(),
});

export type InsightProviderStatus = z.infer<typeof insightProviderStatusSchema>;

export const insightsDatasetSchema = z.object({
  generatedAt: z.string(),
  since: z.string().optional(),
  until: z.string().optional(),
  providers: z.array(insightProviderStatusSchema),
  sessions: z.array(insightSessionRowSchema),
  turns: z.array(insightTurnRowSchema),
  toolCalls: z.array(insightToolCallRowSchema),
  findings: z.array(insightFindingSchema),
});

export type InsightsDataset = z.infer<typeof insightsDatasetSchema>;

// Phase 9.12 (docs/plans/mcp-tools-v2.md §4): the MCP list_findings result —
// findings resolved to their session so a client never has to join keys.
export const enrichedFindingSchema = insightFindingSchema.extend({
  providerId: z.string(),
  sessionId: z.string(),
  sessionTitle: z.string(),
});

export type EnrichedFinding = z.infer<typeof enrichedFindingSchema>;

export const severityCountsSchema = z.object({
  info: z.number(),
  low: z.number(),
  medium: z.number(),
  high: z.number(),
  critical: z.number(),
});

export const findingsQueryResultSchema = z.object({
  generatedAt: z.string(),
  providers: z.array(insightProviderStatusSchema),
  total: z.number(), // matches before maxResults
  bySeverity: severityCountsSchema, // over all matches
  findings: z.array(enrichedFindingSchema), // most severe first
});

export type FindingsQueryResult = z.infer<typeof findingsQueryResultSchema>;
