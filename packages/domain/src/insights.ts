import { z } from "zod";
import { failureCategorySchema, toolCallStatusSchema } from "./tool-call-outcome.js";
import { toolKindSchema } from "./tool-call-record.js";
import { triggeredEventSchema } from "./turn.js";
import { costBasisTotalsSchema, turnCostFiguresSchema } from "./cost-figure.js";

// Phase 9.11 insights dashboard (docs/plans/insights-dashboard.md §3): a
// small star schema of flat, already-redacted rows across every provider.
// The browser's associative engine links them by key: sessions ← turns ←
// toolCalls, and sessions ← findings.

// null = unknown (constraint 6) — never 0, never omitted.
const tokenFigureSchema = z.number().nullable();

// Phase 15 step 15.4 (docs/plans/cost-by-repository-and-project.md §8, §9):
// who a row's cost belongs to and who sold it. Each is null when unknown,
// with its reason beside it (constraint 6): an Unattributed row keeps why
// (and is in no project), an unknown vendor or channel says why. A turn
// row is attributed by its own folder and model; a session row by the
// session's. `projectId: null` on an attributed row is "No project".
const attributionShape = {
  repositoryKey: z.string().min(1).nullable(),
  unattributedReason: z.string().min(1).optional(),
  projectId: z.string().min(1).nullable(),
  vendorId: z.string().min(1).nullable(),
  vendorUnknownReason: z.string().min(1).optional(),
  channel: z.string().min(1).nullable(),
  channelUnknownReason: z.string().min(1).optional(),
};

type AttributionFields = {
  repositoryKey: string | null;
  unattributedReason?: string;
  projectId: string | null;
  vendorId: string | null;
  vendorUnknownReason?: string;
  channel: string | null;
  channelUnknownReason?: string;
};

function checkAttribution(row: AttributionFields, ctx: z.RefinementCtx): void {
  const pairs: [keyof AttributionFields, keyof AttributionFields][] = [
    ["repositoryKey", "unattributedReason"],
    ["vendorId", "vendorUnknownReason"],
    ["channel", "channelUnknownReason"],
  ];
  for (const [value, reason] of pairs) {
    if ((row[value] === null) !== (row[reason] !== undefined)) {
      ctx.addIssue({ code: "custom", path: [reason], message: `${reason} is set exactly when ${value} is null` });
    }
  }
  if (row.repositoryKey === null && row.projectId !== null) {
    ctx.addIssue({ code: "custom", path: ["projectId"], message: "an Unattributed row is in no project" });
  }
}

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
  // The provider doesn't read this session's tool calls (Agent Host): its
  // empty tool-call list means unknown, not zero.
  toolCallsUnavailable: z.boolean().optional(),
  ...attributionShape,
  // Step 15.6: the session's turns summed per cost basis, with coverage.
  // The server always sets it; absent in data from before step 15.6.
  cost: costBasisTotalsSchema.optional(),
}).superRefine(checkAttribution);

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
  toolCallCount: z.number().nullable(), // null: tool calls unknown
  ...attributionShape,
  // Step 15.6: YYYY-MM-DD (UTC) of the turn's own time, else the session's.
  date: z.string().optional(),
  // Step 15.6 (plan §5): the turn's billed, reported and priced figures,
  // each unknown with a reason, never 0. The server always sets it.
  cost: turnCostFiguresSchema.optional(),
}).superRefine(checkAttribution);

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
  // Display names for the ids the rows carry (step 15.4); absent: show ids.
  projects: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
  vendors: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
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
