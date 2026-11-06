import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { costRollupSchema, sessionCostSchema } from "@agent-cost-analyzer/domain";
import { DEFAULT_TOP_SESSIONS } from "../services/cost/cost-rollup-builder.js";
import { DEFAULT_TOP_TURNS } from "../services/cost/session-cost-builder.js";
import { DEFAULT_ROLLUP_SESSION_LIMIT } from "../services/tool-audit/audit-query-service.js";
import type { McpToolDeps } from "./mcp-server.js";
import {
  json,
  projectIdArg,
  providerArg,
  READ_ONLY,
  repositoryArg,
  sessionIdArg,
  sessionsPerProviderArg,
  sinceArg,
  unknownSession,
  untilArg,
  type Guard,
} from "./tool-helpers.js";

// Phase 9.12 (docs/plans/mcp-tools-v2.md §4.1). Step 15.6 (cost-by-
// repository-and-project.md §10.1.2): the cost basis in both tools.

// What every cost figure means, shared by the cost tools and get_turn. It
// names no provider, since the extension's server shares it.
export const COST_BASIS_TEXT =
  "Cost figures carry their basis: billed (what GitHub Copilot billed, AI Credits), reported (what the agent logged itself, USD) and priced (tokens × the price version in force on the turn's channel at the turn's time; see get_price_book, and priceVersionIds). The preferred figure is billed, else reported, else priced. A priced figure with apiEquivalent: true is what the same use costs on the API, though a flat-fee plan may have covered it. An unknown figure is {known:false, reason}, never 0; totals give knownTurns of turns per basis. Currencies stay apart; `usd` converts only at 1 AI Credit = $0.01.";

export function registerCostTools(server: McpServer, deps: McpToolDeps, guarded: Guard): void {
  server.registerTool(
    "get_session_cost",
    {
      title: "Get session cost",
      description:
        "Explains what one session cost and why: token totals (uncached input, cache write, cache read, reasoning, output) and AI Credits, each with turn coverage; cache hit ratio; spend per model; the most expensive turns; cost-relevant events (compaction, cache expiry, model switch, ...); and context overhead (system-prompt parts, tools defined but never used); the session's repository and project. null means unknown, never zero — see unavailableReasons. " +
        COST_BASIS_TEXT,
      inputSchema: {
        sessionId: sessionIdArg,
        provider: providerArg(deps.identity),
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
        "Answers \"what is driving my spend?\" across every available provider (or one, with `provider`) in a date window, optionally for one repository or project: token and AI Credits totals with coverage, per-basis cost totals, cache hit ratio, spend by provider, model, day, repository, project, vendor and channel, the most expensive sessions, and `reconciliation` (Copilot's billed AI Credits against the price book, per model and month: a steady gap means the price book is out of date). Follow up with get_session_cost on a top session. The same data the web Dashboard shows. " +
        COST_BASIS_TEXT,
      inputSchema: {
        provider: z.string().optional().describe("Restrict to one log provider id (see list_log_providers). Default: every available provider."),
        repository: repositoryArg.optional().describe("Only turns attributed to this repository key (from list_repositories)."),
        projectId: projectIdArg.optional().describe("Only turns in this project (from list_projects)."),
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
    ({ provider, repository, projectId, since, until, limit, topSessions }) =>
      guarded(async () =>
        json(await deps.analysisQueries.getCostRollup({ providerId: provider, since, until, limit }, { topSessions, repository, projectId })),
      ),
  );
}
