// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  ACTIVE_SESSION_WINDOW_MINUTES,
  costComparisonSchema,
  costRollupSchema,
  costSeriesSchema,
  costVarianceSchema,
  projectCostSchema,
  sessionCostSchema,
} from "@agent-cost-analyzer/domain";
import { costCompareRequestSchema, costSeriesRequestSchema, costVarianceRequestSchema } from "../services/cost-analysis/cost-query-params.js";
import type { AttributionQueries } from "../services/cost-attribution/attribution-query-service.js";
import type { CostAnalysisQueries } from "../services/cost-analysis/cost-analysis-service.js";
import { DEFAULT_TOP_PROJECT_SESSIONS, MAX_TOP_PROJECT_SESSIONS } from "../services/cost-analysis/project-cost-builder.js";
import { DEFAULT_TOP_SESSIONS } from "../services/cost/cost-rollup-builder.js";
import { DEFAULT_TOP_TURNS } from "../services/cost/session-cost-builder.js";
import { DEFAULT_ROLLUP_SESSION_LIMIT } from "../services/tool-audit/audit-query-service.js";
import type { McpToolDeps } from "./mcp-server.js";
import { rollupActivitySentence, sessionActivitySentence } from "./session-activity-text.js";
import {
  basisArg,
  bucketArg,
  comparePeriodArg,
  costIdsArg,
  costSinceArg,
  costUntilArg,
  currencyArg,
  json,
  pricingArg,
  projectIdArg,
  providerArg,
  READ_ONLY,
  repositoryArg,
  sessionIdArg,
  sessionsPerProviderArg,
  sinceArg,
  toolError,
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

// docs/plans/mcp-apps.md §4.7: a running chat's log is incomplete, so its
// figures are not final.
const ACTIVE_TEXT = `\`active\`: true marks a session whose latest turn started in the last ${ACTIVE_SESSION_WINDOW_MINUTES} minutes; its figures may still change.`;

// The JSON stays the first text item (clients parse it); the sentence follows.
function withSentence(result: CallToolResult, sentence: string | undefined): CallToolResult {
  return sentence ? { ...result, content: [...result.content, { type: "text", text: sentence }] } : result;
}

export function registerCostTools(server: McpServer, deps: McpToolDeps, guarded: Guard): void {
  server.registerTool(
    "get_session_cost",
    {
      title: "Get session cost",
      description:
        "Explains what one session cost and why: token totals (uncached input, cache write, cache read, reasoning, output) and AI Credits, each with turn coverage; cache hit ratio; spend per model; the most expensive turns; cost-relevant events (compaction, cache expiry, model switch, ...); and context overhead (system-prompt parts, tools defined but never used); the session's repository and project. null means unknown, never zero — see unavailableReasons. " +
        ACTIVE_TEXT +
        " " +
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
        return cost ? withSentence(json(cost), sessionActivitySentence(cost, deps.analysisQueries.now())) : unknownSession(sessionId, provider);
      }),
  );

  server.registerTool(
    "get_cost_rollup",
    {
      title: "Get cross-session cost rollup",
      description:
        "Answers \"what is driving my spend?\" across every available provider (or one, with `provider`) in a date window, optionally for one repository or project: token and AI Credits totals with coverage, per-basis cost totals, cache hit ratio, spend by provider, model, day, repository, project, vendor and channel, the most expensive sessions, and `reconciliation` (Copilot's billed AI Credits against the price book, per model and month: a steady gap means the price book is out of date). Follow up with get_session_cost on a top session. The same data the web Dashboard shows. " +
        ACTIVE_TEXT +
        " " +
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
      guarded(async () => {
        const rollup = await deps.analysisQueries.getCostRollup({ providerId: provider, since, until, limit }, { topSessions, repository, projectId });
        return withSentence(json(rollup), rollupActivitySentence(rollup.topSessions, deps.analysisQueries.now()));
      }),
  );
}

// Phase 15 step 15.7 (cost-by-repository-and-project.md §10.1.1): cost over
// time for one repository or project, and the compare table. Registered
// with the cost analyses (the standalone server; the extension's server
// gets them with step 15.13's toolGroups).
const SERIES_TEXT =
  "Returns totals per basis with coverage (knownTurns of turns), one point per bucket in the range (UTC; a bucket with turns but nothing known has usd null and no amounts: a gap, never 0) with a running total, a breakdown by vendor then model, and the documented price changes in the range for the models priced (priceChanges). Turns are bucketed by their own date; sessions are selected by their start. Local repositories are named by folder only.";

function seriesArgs(deps: McpToolDeps) {
  return {
    since: costSinceArg,
    until: costUntilArg,
    bucket: bucketArg,
    basis: basisArg,
    pricing: pricingArg,
    currency: currencyArg,
    provider: providerArg(deps.identity).describe("Restrict to one log provider id (see list_log_providers). Default: every available provider."),
    limit: sessionsPerProviderArg(DEFAULT_ROLLUP_SESSION_LIMIT),
  };
}

type SeriesArgs = {
  since?: string;
  until?: string;
  bucket?: string;
  basis?: string;
  pricing?: string;
  currency?: string;
  provider?: string;
  limit?: number;
};

function seriesRequest(args: SeriesArgs) {
  const { provider, ...rest } = args;
  return costSeriesRequestSchema.parse({ ...rest, ...(provider !== undefined ? { providerId: provider } : {}) });
}

// A product with no projects says why when a project id is unknown (D19), so
// the model and the U9 view can show the reason instead of a bare id error.
function unknownProjectText(projectId: string, attribution: Pick<AttributionQueries, "listProjects"> | undefined): string {
  const base = `Unknown project id "${projectId}". Call list_projects to find valid ids.`;
  const list = attribution?.listProjects();
  return list !== undefined && list.projects.length === 0 && list.reason !== undefined ? `${base} ${list.reason}` : base;
}

export function registerCostAnalysisTools(
  server: McpServer,
  deps: McpToolDeps,
  analysis: CostAnalysisQueries,
  guarded: Guard,
  attribution?: Pick<AttributionQueries, "listProjects">,
): void {
  server.registerTool(
    "get_repository_cost",
    {
      title: "Get a repository's cost over time",
      description:
        "Answers \"what did this repository cost, and how did it change?\" for one repository key from list_repositories, across every available provider unless `provider` is given. Defaults: monthly buckets, the preferred basis, prices as of use, native currencies. " +
        SERIES_TEXT +
        " " +
        COST_BASIS_TEXT,
      inputSchema: { repository: repositoryArg, ...seriesArgs(deps) },
      outputSchema: costSeriesSchema,
      annotations: READ_ONLY,
    },
    ({ repository, ...args }) => guarded(async () => json(await analysis.getRepositoryCost({ ...seriesRequest(args), repository }))),
  );

  server.registerTool(
    "get_project_cost",
    {
      title: "Get a project's cost over time and breakdown",
      description:
        "Answers \"what did this project cost, where did the money go?\" for one project id from list_projects: everything get_repository_cost returns for the project's turns, plus a breakdown by repository member, by vendor then model, tokens per model by type (uncached input, cache write, cache read, reasoning, output) and the most expensive sessions. Defaults: monthly buckets, the preferred basis, prices as of use, native currencies. " +
        SERIES_TEXT +
        " " +
        COST_BASIS_TEXT,
      inputSchema: {
        projectId: projectIdArg,
        ...seriesArgs(deps),
        topSessions: z
          .number()
          .int()
          .min(1)
          .max(MAX_TOP_PROJECT_SESSIONS)
          .optional()
          .describe(`How many of the most expensive sessions to return (default ${DEFAULT_TOP_PROJECT_SESSIONS}, max ${MAX_TOP_PROJECT_SESSIONS}).`),
      },
      outputSchema: projectCostSchema,
      annotations: READ_ONLY,
    },
    ({ projectId, topSessions, ...args }) =>
      guarded(async () => {
        const cost = await analysis.getProjectCost({ ...seriesRequest(args), projectId, ...(topSessions !== undefined ? { topSessions } : {}) });
        return cost ? json(cost) : toolError(unknownProjectText(projectId, attribution));
      }),
  );

  server.registerTool(
    "compare_costs",
    {
      title: "Compare repositories or projects",
      description:
        "Compares 2 to 20 repositories (keys from list_repositories) or projects (ids from list_projects) over one period: per id the total with coverage, the change against the previous period (or the same dates last year), cost per session, per active day and per turn, share of the compared total, cache-hit ratio and output share. Money measures are per currency unless currency is \"usd\"; a change against a period with nothing known is null, never \"from 0\". Defaults: the preferred basis, prices as of use, native currencies, the previous period. " +
        COST_BASIS_TEXT,
      inputSchema: {
        groupBy: z.enum(["repository", "project"]).describe('Compare repositories or projects.'),
        ids: costIdsArg,
        since: costSinceArg.unwrap().describe('First day of the period, inclusive: "YYYY-MM-DD" (UTC).'),
        until: costUntilArg.unwrap().describe('Last day of the period, inclusive: "YYYY-MM-DD" (UTC).'),
        comparePeriod: comparePeriodArg,
        basis: basisArg,
        pricing: pricingArg,
        currency: currencyArg,
        provider: providerArg(deps.identity).describe("Restrict to one log provider id (see list_log_providers). Default: every available provider."),
        limit: sessionsPerProviderArg(DEFAULT_ROLLUP_SESSION_LIMIT),
      },
      outputSchema: costComparisonSchema,
      annotations: READ_ONLY,
    },
    ({ provider, ...args }) =>
      guarded(async () => json(await analysis.compare(costCompareRequestSchema.parse({ ...args, ...(provider !== undefined ? { providerId: provider } : {}) })))),
  );

  // Step 15.10 (plan §8.4, D12, §10.1.1).
  const periodArg = z
    .union([z.string(), z.object({ since: z.string(), until: z.string() })])
    .describe('A month "YYYY-MM", or {since, until} as "YYYY-MM-DD" (UTC, inclusive).');
  server.registerTool(
    "explain_cost_change",
    {
      title: "Explain why a cost changed",
      description:
        "Answers \"costs went up 30%: was it a price change, more work, or a different model?\" for one repository (key from list_repositories) or project (id from list_projects) between period A and period B. " +
        "On the priced basis, as of use (tokens × the price version in force when each turn ran), per currency: the usage effect (more or fewer tokens at A's average price), the price effect (B's tokens × the change in unit price) and the mix effect (work moved between models), which add up exactly to the change; " +
        "per model and token type (uncached input, cache read, cache write, output) with unit prices and the price versions behind them; turns without a priced figure counted as notExplained with reasons, never 0; and the documented price changes between the periods. " +
        "Follow up with get_price_changes for the models with the largest price effect. Local repositories are named by folder only. Currencies stay apart unless currency is \"usd\" (1 AI Credit = $0.01).",
      inputSchema: {
        groupBy: z.enum(["repository", "project"]).describe("Explain a repository's or a project's change."),
        id: z.string().min(1).describe("The repository key or project id."),
        periodA: periodArg,
        periodB: periodArg,
        currency: currencyArg,
        provider: providerArg(deps.identity).describe("Restrict to one log provider id (see list_log_providers). Default: every available provider."),
        limit: sessionsPerProviderArg(DEFAULT_ROLLUP_SESSION_LIMIT),
      },
      outputSchema: costVarianceSchema,
      annotations: READ_ONLY,
    },
    ({ provider, ...args }) =>
      guarded(async () => {
        const parsed = costVarianceRequestSchema.safeParse({ ...args, ...(provider !== undefined ? { providerId: provider } : {}) });
        if (!parsed.success) return toolError(parsed.error.issues.map((issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`).join("; "));
        return json(await analysis.explainChange(parsed.data));
      }),
  );
}
