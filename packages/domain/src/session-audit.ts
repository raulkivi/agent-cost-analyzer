// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { z } from "zod";
import { subagentLabelSchema, subagentRunIdSchema } from "./subagent-run-ids.js";
import { tokenCountSchema } from "./token-count.js";
import { failureCategorySchema } from "./tool-call-outcome.js";
import { toolCallRecordSchema } from "./tool-call-record.js";

// Phase 9.10 (docs/plans/tool-call-audit.md §4): provider-agnostic
// aggregates computed server-side from normalized ToolCallRecords.

export const outcomeTotalsSchema = z.object({
  toolCalls: z.number(),
  succeeded: z.number(),
  failed: z.number(),
  interrupted: z.number(),
  denied: z.number(),
  unknown: z.number(),
  // D14: a user stop. Counted in toolCalls, never a failure or an unknown
  // outcome, and left out of the failure rate. Absent = none (older clients
  // and fixtures); the builders always set it.
  canceled: z.number().optional(),
});

export type OutcomeTotals = z.infer<typeof outcomeTotalsSchema>;

// (failed + interrupted + denied) / calls with a known outcome; null when no
// call's outcome is known, so the UI never shows a fabricated 0%.
const failureRateSchema = z.number().min(0).max(1).nullable();

const toolBreakdownSchema = z.object({
  name: z.string(),
  calls: z.number(),
  failed: z.number(),
  totalDurationMs: z.number().optional(),
});

const programBreakdownSchema = z.object({ program: z.string(), calls: z.number(), failed: z.number() });

const categoryCountSchema = z.object({ category: failureCategorySchema, count: z.number() });

export const outcomeCoverageSchema = z.object({
  known: z.number(),
  unknown: z.number(),
  unknownReasons: z.array(z.string()),
});

// Step 10.20: the totals split by who issued the calls; main + subagents
// equals the all-calls totals.
export const originTotalsSchema = z.object({
  main: outcomeTotalsSchema,
  subagents: outcomeTotalsSchema.extend({ runs: z.number() }),
});

export type OriginTotals = z.infer<typeof originTotalsSchema>;

// One subagent run in a session's audit. `totals` null = the run was not
// read (never 0). `unreadReason` is required then, and may also accompany
// known totals as a flag (D12: a run whose start call is missing).
export const auditedRunSchema = z
  .object({
    runId: subagentRunIdSchema,
    label: subagentLabelSchema,
    depth: z.number().int().min(1).max(8),
    parentRunId: subagentRunIdSchema.optional(),
    turnIndex: z.number(),
    totals: outcomeTotalsSchema.nullable(),
    failureRate: failureRateSchema,
    unreadReason: z.string().optional(),
  })
  .superRefine((run, ctx) => {
    if (run.totals === null && !run.unreadReason) {
      ctx.addIssue({ code: "custom", message: "An unread run must carry a reason.", path: ["unreadReason"] });
    }
  });

export type AuditedRun = z.infer<typeof auditedRunSchema>;

export const auditedToolCallSchema = z.object({
  turnIndex: z.number(),
  call: toolCallRecordSchema,
});

export type AuditedToolCall = z.infer<typeof auditedToolCallSchema>;

export const retryGroupSchema = z.object({
  command: z.string(),
  attempts: z.number(),
  eventuallySucceeded: z.boolean(),
  turnIndexes: z.array(z.number()),
});

export type RetryGroup = z.infer<typeof retryGroupSchema>;

export const sessionAuditSchema = z.object({
  sessionId: z.string(),
  providerId: z.string().optional(),
  title: z.string().optional(),
  startedAt: z.string().optional(),
  totals: outcomeTotalsSchema,
  failureRate: failureRateSchema,
  byTool: z.array(toolBreakdownSchema),
  byShellProgram: z.array(programBreakdownSchema),
  byFailureCategory: z.array(categoryCountSchema),
  perTurn: z.array(outcomeTotalsSchema.omit({ toolCalls: true }).extend({ turnIndex: z.number() })),
  calls: z.array(auditedToolCallSchema),
  retries: z.array(retryGroupSchema),
  // Each LLM round that contained a failed call forces at least one
  // follow-up round spent reacting to it. Per-round tokens aren't part of
  // the normalized Session, so cost is reported exactly for the *affected
  // turns* rather than estimated per round (constraint 6).
  failureRecoveryCost: z.object({
    recoveryRounds: z.number(),
    affectedTurns: z.array(z.number()),
    affectedTurnsOutputTokens: tokenCountSchema,
    affectedTurnsInputTokens: tokenCountSchema, // uncached + cache write + cache read
  }),
  outcomeCoverage: outcomeCoverageSchema,
  // Set when the provider doesn't record this session's tool calls at all, so
  // the empty `calls` reads as "not available", never as "no tool calls".
  toolCallsUnavailableReason: z.string().optional(),
  // Step 10.20: present when the session has any subagent run.
  byOrigin: originTotalsSchema.optional(),
  subagentRuns: z.array(auditedRunSchema).optional(),
});

export type SessionAudit = z.infer<typeof sessionAuditSchema>;

export const auditRollupSchema = z.object({
  providerId: z.string().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  // Sessions counted below; sessions whose tool calls are unknown (Agent
  // Host, step 10.13) are left out of every count and rate, not counted as 0.
  sessionCount: z.number(),
  sessionsWithUnknownToolCalls: z.number().default(0),
  toolCallsUnavailableReason: z.string().optional(),
  totals: outcomeTotalsSchema,
  failureRate: failureRateSchema,
  byTool: z.array(toolBreakdownSchema),
  byShellProgram: z.array(programBreakdownSchema),
  byFailureCategory: z.array(categoryCountSchema),
  topFailingCommands: z.array(
    z.object({
      command: z.string(),
      program: z.string().optional(),
      failures: z.number(),
      sessions: z.number(),
      failureCategory: failureCategorySchema.optional(),
    }),
  ),
  daily: z.array(outcomeTotalsSchema.extend({ date: z.string() })),
  sessions: z.array(
    z.object({
      sessionId: z.string(),
      title: z.string(),
      startedAt: z.string().optional(),
      toolCalls: z.number(),
      failed: z.number(), // error + interrupted + denied
      unknown: z.number(),
    }),
  ),
  outcomeCoverage: outcomeCoverageSchema,
  byOrigin: originTotalsSchema.optional(),
  sessionsWithUnreadSubagentRuns: z.number().default(0),
});

export type AuditRollup = z.infer<typeof auditRollupSchema>;
