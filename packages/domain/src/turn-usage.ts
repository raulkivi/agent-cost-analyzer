// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { z } from "zod";
import { tokenCountSchema } from "./token-count.js";

// The main agent's own figures for a turn that also folds in subagent runs
// (step 10.19, D10). Kept beside the folded total so a per-model line stays
// known for the parent's model when a run is unknown.
export const ownTurnUsageSchema = z.object({
  uncachedInput: tokenCountSchema,
  cacheWrite: tokenCountSchema,
  cacheRead: tokenCountSchema,
  tool: tokenCountSchema,
  vision: tokenCountSchema,
  reasoning: tokenCountSchema,
  output: tokenCountSchema,
  costAiCredits: tokenCountSchema,
  model: z.string(),
});

export type OwnTurnUsage = z.infer<typeof ownTurnUsageSchema>;

// One classic Copilot Chat subagent run (runSubagent / searchSubagent) folded
// into the turn that started it. `id` and `label` come from a log file, so
// both are pattern- and length-capped: they reach the UI and MCP tools.
export const subagentRunUsageSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), // childSessionId (the tool call id)
  label: z.string().regex(/^(runSubagent-[A-Za-z0-9_ -]{1,64}|searchSubagent)$/),
  agentName: z.string().max(64).optional(), // from the run's `subagent` event
  model: z.string(), // latest known model of its requests
  roundsCount: z.number().int().nonnegative(), // its llm_requests
  uncachedInput: tokenCountSchema,
  cacheWrite: tokenCountSchema,
  cacheRead: tokenCountSchema,
  reasoning: tokenCountSchema,
  output: tokenCountSchema,
  costAiCredits: tokenCountSchema,
  startedAt: z.string().datetime().optional(),
  // child-session-ref: the parent's own reference placed it; timestamp: an
  // unreferenced file matched to the turn by time (shown as "matched by time").
  attribution: z.enum(["child-session-ref", "timestamp"]),
});

export type SubagentRunUsage = z.infer<typeof subagentRunUsageSchema>;

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
  // Step 10.19: when present, the figures above are everything billed for
  // the turn (the main agent plus these runs); absent: no run was read.
  subagents: z.array(subagentRunUsageSchema).optional(),
  // The main agent's own figures; present exactly when `subagents` is.
  ownUsage: ownTurnUsageSchema.optional(),
}).superRefine((usage, ctx) => {
  if ((usage.subagents === undefined) !== (usage.ownUsage === undefined)) {
    ctx.addIssue({ code: "custom", path: ["ownUsage"], message: "ownUsage is set exactly when subagents is" });
  }
});

export type TurnUsage = z.infer<typeof turnUsageSchema>;
