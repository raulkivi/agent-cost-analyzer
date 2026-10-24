import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { costRollupSchema, sessionCostSchema } from "@copilot-cost-analyzer/domain";
import { DEFAULT_TOP_SESSIONS } from "../services/cost/cost-rollup-builder.js";
import { DEFAULT_TOP_TURNS } from "../services/cost/session-cost-builder.js";
import { DEFAULT_ROLLUP_SESSION_LIMIT } from "../services/tool-audit/audit-query-service.js";
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

// Phase 9.12 (docs/plans/mcp-tools-v2.md §4.1).

export function registerCostTools(server: McpServer, deps: McpServerDeps, guarded: Guard): void {
  server.registerTool(
    "get_session_cost",
    {
      title: "Get session cost",
      description:
        "Explains what one session cost and why: token totals (uncached input, cache write, cache read, reasoning, output) and AI Credits, each with turn coverage; cache hit ratio; spend per model; the most expensive turns; cost-relevant events (compaction, cache expiry, model switch, ...); and context overhead (system-prompt parts, tools defined but never used). null means unknown, never zero — see unavailableReasons.",
      inputSchema: {
        sessionId: sessionIdArg,
        provider: providerArg,
        topTurns: z.number().int().min(1).max(50).optional().describe(`How many of the most expensive turns to return (default ${DEFAULT_TOP_TURNS}).`),
      },
      outputSchema: sessionCostSchema,
      annotations: READ_ONLY,
    },
    ({ sessionId, provider, topTurns }) =>
      guarded(async () => {
        const cost = await deps.analysisQueries.getSessionCost(sessionId, provider, { topTurns });
        return cost ? json(cost) : unknownSession(sessionId, provider);
      }),
  );

  server.registerTool(
    "get_cost_rollup",
    {
      title: "Get cross-session cost rollup",
      description:
        "Answers \"what is driving my spend?\" across every available provider (or one, with `provider`) in a date window: token and AI Credits totals with coverage, cache hit ratio, spend by provider, model and day, and the most expensive sessions. Follow up with get_session_cost on a top session. The same data the web Dashboard shows.",
      inputSchema: {
        provider: z.string().optional().describe("Restrict to one log provider id (see list_log_providers). Default: every available provider."),
        since: sinceArg,
        until: untilArg,
        limit: sessionsPerProviderArg(DEFAULT_ROLLUP_SESSION_LIMIT),
        topSessions: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe(`How many of the most expensive sessions to return (default ${DEFAULT_TOP_SESSIONS}).`),
      },
      outputSchema: costRollupSchema,
      annotations: READ_ONLY,
    },
    ({ provider, since, until, limit, topSessions }) =>
      guarded(async () => json(await deps.analysisQueries.getCostRollup({ providerId: provider, since, until, limit }, { topSessions }))),
  );
}
