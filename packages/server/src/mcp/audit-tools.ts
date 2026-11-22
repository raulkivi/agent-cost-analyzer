// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  auditedToolCallSchema,
  auditRollupSchema,
  failureCategorySchema,
  sessionAuditSchema,
  subagentRunIdSchema,
  toolCallStatusSchema,
  toolKindSchema,
} from "@agent-cost-analyzer/domain";
import { DEFAULT_ROLLUP_SESSION_LIMIT } from "../services/tool-audit/audit-query-service.js";
import { limitSchema, offsetSchema, toolCallOriginKindSchema, turnIndexSchema } from "../services/tool-audit/audit-query-params.js";
import { publicAuditedCall } from "./audit-call-output.js";
import type { McpToolDeps } from "./mcp-server.js";
import {
  json,
  providerArg,
  READ_ONLY,
  sessionIdArg,
  sessionsPerProviderArg,
  sinceArg,
  unknownSession,
  untilArg,
  type Guard,
} from "./tool-helpers.js";

// Phase 9.10 tools (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/tool-call-audit.md §10), refined in 9.12.

const DEFAULT_TOOL_CALL_LIMIT = 50;

export function registerAuditTools(server: McpServer, deps: McpToolDeps, guarded: Guard): void {
  server.registerTool(
    "get_session_audit",
    {
      title: "Get session tool-call audit",
      description:
        "Summarizes how one session's tool calls went: totals by outcome (success/error/interrupted/denied/unknown), failure rate, breakdowns by tool, shell program and failure category (command-not-found, wrong-directory, invalid-arguments, dependency-missing, git-state, ...), per-turn counts, retried commands, the tokens spent recovering from failures, and outcome coverage. Counts include tool calls made inside subagent runs; byOrigin splits main agent and subagents; a run whose calls couldn't be read is listed with its reason, never as 0. Start here for \"why did the agent struggle?\"; use list_tool_calls for the individual calls.",
      inputSchema: z.object({
        sessionId: sessionIdArg,
        provider: providerArg(deps.identity),
        includeCalls: z
          .boolean()
          .optional()
          .describe("Also return every classified call (default false; can be large — prefer list_tool_calls with filters)."),
      }),
      outputSchema: sessionAuditSchema.partial({ calls: true }),
      annotations: READ_ONLY,
    },
    ({ sessionId, provider, includeCalls }) =>
      guarded(async () => {
        const audit = await deps.auditQueries.getSessionAudit(sessionId, provider);
        if (!audit) {
          return unknownSession(sessionId, provider);
        }
        if (includeCalls) {
          return json({ ...audit, calls: audit.calls.map(publicAuditedCall) });
        }
        const { calls: _calls, ...compact } = audit;
        void _calls;
        return json(compact);
      }),
  );

  server.registerTool(
    "list_tool_calls",
    {
      title: "List classified tool calls",
      description:
        "Lists one session's tool calls with outcome, exit code, failure category, a redacted stderr excerpt, the command and program, and the turn index. Each call says whether the main agent or a subagent run made it. Filter by outcome, failure category, tool kind (shell, file-write, web, mcp, subagent, ...), tool name, shell program, turn, origin (main or subagent) or one subagent run; page with offset/limit (`total` counts every match). For a VS Code Agent Host session without a Copilot CLI event log the list is empty and toolCallsUnavailableReason says why: the calls are unknown, not zero.",
      inputSchema: z.object({
        sessionId: sessionIdArg,
        provider: providerArg(deps.identity),
        status: z.array(toolCallStatusSchema).optional().describe('Keep only these outcomes, e.g. ["error","interrupted","denied"].'),
        failureCategory: z.array(failureCategorySchema).optional().describe("Keep only these failure categories."),
        kind: z.array(toolKindSchema).optional().describe('Keep only these tool kinds, e.g. ["shell"] or ["web","mcp"].'),
        tool: z.string().optional().describe('Exact tool name, e.g. "Bash" or "run_in_terminal".'),
        program: z.string().optional().describe('Shell program, e.g. "npm" or "git".'),
        turnIndex: turnIndexSchema.optional().describe("Only this 0-based turn."),
        origin: z.array(toolCallOriginKindSchema).optional().describe('Keep only calls by the main agent or by subagents, e.g. ["subagent"]. Default: both.'),
        runId: subagentRunIdSchema.optional().describe("Only calls made by this subagent run (its origin.runId)."),
        offset: offsetSchema.optional().describe("Skip this many matching calls (default 0)."),
        limit: limitSchema.optional().describe(`Maximum calls to return (default ${DEFAULT_TOOL_CALL_LIMIT}).`),
      }),
      outputSchema: z.object({
        total: z.number(),
        offset: z.number(),
        calls: z.array(auditedToolCallSchema),
        toolCallsUnavailableReason: z.string().optional(),
      }),
      annotations: READ_ONLY,
    },
    ({ sessionId, provider, limit, offset, ...filter }) =>
      guarded(async () => {
        const result = await deps.auditQueries.listToolCalls(
          sessionId,
          { ...filter, offset, limit: limit ?? DEFAULT_TOOL_CALL_LIMIT },
          provider,
        );
        return result ? json({ total: result.total, offset: offset ?? 0, calls: result.calls.map(publicAuditedCall), ...(result.toolCallsUnavailableReason ? { toolCallsUnavailableReason: result.toolCallsUnavailableReason } : {}) }) : unknownSession(sessionId, provider);
      }),
  );

  server.registerTool(
    "get_audit_rollup",
    {
      title: "Get cross-session tool-call rollup",
      description:
        "Aggregates tool-call outcomes across one provider's most recent sessions in a date window: totals, failure rate, the top failing commands (and in how many sessions they failed), failures per day, a per-session summary, and breakdowns by tool, program and failure category. Sessions whose tool calls are unknown (a VS Code Agent Host session without a Copilot CLI event log) are not included in any count or rate; sessionsWithUnknownToolCalls says how many were left out and toolCallsUnavailableReason why. Counts include tool calls made inside subagent runs; byOrigin splits main agent and subagents; a session whose subagent calls couldn't be read stays in every count and is tallied in sessionsWithUnreadSubagentRuns, never as 0. Use it for \"which commands keep failing?\".",
      inputSchema: z.object({
        provider: providerArg(deps.identity),
        since: sinceArg,
        until: untilArg,
        limit: sessionsPerProviderArg(DEFAULT_ROLLUP_SESSION_LIMIT),
      }),
      outputSchema: auditRollupSchema,
      annotations: READ_ONLY,
    },
    ({ provider, since, until, limit }) =>
      guarded(async () => json(await deps.auditQueries.getRollup({ providerId: provider, since, until, limit }))),
  );
}
