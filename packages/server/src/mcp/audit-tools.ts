import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  auditedToolCallSchema,
  auditRollupSchema,
  failureCategorySchema,
  sessionAuditSchema,
  toolCallStatusSchema,
  toolKindSchema,
} from "@copilot-cost-analyzer/domain";
import { DEFAULT_ROLLUP_SESSION_LIMIT } from "../services/tool-audit/audit-query-service.js";
import { limitSchema, offsetSchema, turnIndexSchema } from "../services/tool-audit/audit-query-params.js";
import type { McpServerDeps } from "./mcp-server.js";
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

// Phase 9.10 tools (docs/plans/tool-call-audit.md §10), refined in 9.12.

const DEFAULT_TOOL_CALL_LIMIT = 50;

export function registerAuditTools(server: McpServer, deps: McpServerDeps, guarded: Guard): void {
  server.registerTool(
    "get_session_audit",
    {
      title: "Get session tool-call audit",
      description:
        "Summarises how one session's tool calls went: totals by outcome (success/error/interrupted/denied/unknown), failure rate, breakdowns by tool, shell program and failure category (command-not-found, wrong-directory, invalid-arguments, dependency-missing, git-state, ...), per-turn counts, retried commands, the tokens spent recovering from failures, and outcome coverage. Start here for \"why did the agent struggle?\"; use list_tool_calls for the individual calls.",
      inputSchema: {
        sessionId: sessionIdArg,
        provider: providerArg,
        includeCalls: z
          .boolean()
          .optional()
          .describe("Also return every classified call (default false; can be large — prefer list_tool_calls with filters)."),
      },
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
          return json(audit);
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
        "Lists one session's tool calls with outcome, exit code, failure category, a redacted stderr excerpt, the command and program, and the turn index. Filter by outcome, failure category, tool kind (shell, file-write, web, mcp, subagent, ...), tool name, shell program or turn; page with offset/limit (`total` counts every match).",
      inputSchema: {
        sessionId: sessionIdArg,
        provider: providerArg,
        status: z.array(toolCallStatusSchema).optional().describe('Keep only these outcomes, e.g. ["error","interrupted","denied"].'),
        failureCategory: z.array(failureCategorySchema).optional().describe("Keep only these failure categories."),
        kind: z.array(toolKindSchema).optional().describe('Keep only these tool kinds, e.g. ["shell"] or ["web","mcp"].'),
        tool: z.string().optional().describe('Exact tool name, e.g. "Bash" or "run_in_terminal".'),
        program: z.string().optional().describe('Shell program, e.g. "npm" or "git".'),
        turnIndex: turnIndexSchema.optional().describe("Only this 0-based turn."),
        offset: offsetSchema.optional().describe("Skip this many matching calls (default 0)."),
        limit: limitSchema.optional().describe(`Maximum calls to return (default ${DEFAULT_TOOL_CALL_LIMIT}).`),
      },
      outputSchema: z.object({ total: z.number(), offset: z.number(), calls: z.array(auditedToolCallSchema) }),
      annotations: READ_ONLY,
    },
    ({ sessionId, provider, limit, offset, ...filter }) =>
      guarded(async () => {
        const result = await deps.auditQueries.listToolCalls(
          sessionId,
          { ...filter, offset, limit: limit ?? DEFAULT_TOOL_CALL_LIMIT },
          provider,
        );
        return result ? json({ total: result.total, offset: offset ?? 0, calls: result.calls }) : unknownSession(sessionId, provider);
      }),
  );

  server.registerTool(
    "get_audit_rollup",
    {
      title: "Get cross-session tool-call rollup",
      description:
        "Aggregates tool-call outcomes across one provider's most recent sessions in a date window: totals, failure rate, the top failing commands (and in how many sessions they failed), failures per day, a per-session summary, and breakdowns by tool, program and failure category. Use it for \"which commands keep failing?\".",
      inputSchema: {
        provider: providerArg,
        since: sinceArg,
        until: untilArg,
        limit: sessionsPerProviderArg(DEFAULT_ROLLUP_SESSION_LIMIT),
      },
      outputSchema: auditRollupSchema,
      annotations: READ_ONLY,
    },
    ({ provider, since, until, limit }) =>
      guarded(async () => json(await deps.auditQueries.getRollup({ providerId: provider, since, until, limit }))),
  );
}
