import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { findingKindSchema, findingSeveritySchema, findingsQueryResultSchema } from "@copilot-cost-analyzer/domain";
import { DEFAULT_MAX_FINDINGS } from "../services/insights/findings-query.js";
import { DEFAULT_ROLLUP_SESSION_LIMIT } from "../services/tool-audit/audit-query-service.js";
import { limitSchema } from "../services/tool-audit/audit-query-params.js";
import type { McpServerDeps } from "./mcp-server.js";
import { json, READ_ONLY, sessionsPerProviderArg, sinceArg, untilArg, type Guard } from "./tool-helpers.js";

// Phase 9.12 (docs/plans/mcp-tools-v2.md §4): the Phase 9.11 detectors'
// findings over MCP (replaces the planned list_security_findings).

export function registerFindingTools(server: McpServer, deps: McpServerDeps, guarded: Guard): void {
  server.registerTool(
    "list_findings",
    {
      title: "List security, anomaly and behaviour-change findings",
      description:
        "Lists what the analyzer flagged across every available provider (or one) in a date window, most severe first: security (credential access, pipe-to-shell, destructive or history-rewriting commands, privilege escalation, data upload, ...), anomalies (cost or failure outliers) and behaviour changes (first use of a program, tool or model). Each finding says what happened, when, in which session and turn, why it was flagged, with redacted evidence. Use get_turn to see the context.",
      inputSchema: {
        provider: z.string().optional().describe("Restrict to one log provider id (see list_log_providers). Default: every available provider."),
        since: sinceArg,
        until: untilArg,
        limit: sessionsPerProviderArg(DEFAULT_ROLLUP_SESSION_LIMIT),
        kind: z.array(findingKindSchema).optional().describe('Keep only these kinds, e.g. ["security"].'),
        minSeverity: findingSeveritySchema.optional().describe("Keep findings at or above this severity (info < low < medium < high < critical)."),
        category: z.string().optional().describe('Exact category, case-insensitive, e.g. "credential-access" or "cost-outlier".'),
        sessionId: z.string().optional().describe("Only findings in this session."),
        maxResults: limitSchema.optional().describe(`Maximum findings to return (default ${DEFAULT_MAX_FINDINGS}); total and bySeverity count every match.`),
      },
      outputSchema: findingsQueryResultSchema,
      annotations: READ_ONLY,
    },
    ({ provider, since, until, limit, ...filter }) =>
      guarded(async () => json(await deps.analysisQueries.listFindings({ providerId: provider, since, until, limit }, filter))),
  );
}
