// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RESOURCE_MIME_TYPE, RESOURCE_URI_META_KEY, registerAppResource, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { turnSeriesSchema } from "@agent-cost-analyzer/domain";
import type { AnalysisQueryService } from "../../services/analysis/analysis-query-service.js";
import { DEFAULT_MAX_TURNS, MAX_TURNS_LIMIT } from "../../services/cost/turn-series-builder.js";
import type { McpIdentity } from "../mcp-identity.js";
import { json, providerArg, READ_ONLY, sessionIdArg, unknownSession, type Guard } from "../tool-helpers.js";
import { injectBrand } from "./inject-brand.js";
import { toViewBrand } from "./view-brand.js";
import type { ViewSource } from "./view-source.js";

// Phase 12 (docs/plans/mcp-apps.md §4.2, §4.5): the MCP App views as a tool
// group. One resource holds every view; each increment adds the names of the
// tools it gives a view to APP_VIEW_TOOL_NAMES. A tool gets _meta.ui only
// when the server actually registered it.

export const APP_VIEW_TOOL_NAMES: readonly string[] = [
  "get_session_cost",
  "get_cost_rollup",
  "list_findings",
  // A19: the Phase 15 cost-analysis tools; their routes (U9-U11) arrive with A20-A22.
  "get_repository_cost",
  "get_project_cost",
  "compare_costs",
  "explain_cost_change",
  // A26: Increment 3; routes U12-U15, U4, U5 arrive with A27-A30. get_statement
  // and estimate_cost exist only in the standalone product (no billing group).
  "replay_session",
  "compare_models_for_session",
  "get_price_changes",
  "get_statement",
  "estimate_cost",
  "get_session_audit",
  "get_audit_rollup",
  "list_sessions",
];

export function viewsResourceUri(identity: McpIdentity): string {
  return `ui://${identity.name}/views.html`;
}

export interface AppViewsDeps {
  identity: McpIdentity;
  version: string;
  source: ViewSource;
  analysisQueries: AnalysisQueryService;
}

// The tools registered so far, by name (see captureRegisteredTools).
export type RegisteredTools = ReadonlyMap<string, RegisteredTool>;

// Records what server.registerTool returns, by tool name, so the views group
// can add _meta to tools the other groups registered without those groups
// knowing. Call it before the groups register.
export function captureRegisteredTools(server: McpServer): RegisteredTools {
  const tools = new Map<string, RegisteredTool>();
  const register = server.registerTool.bind(server) as (...args: unknown[]) => RegisteredTool;
  (server as unknown as { registerTool: (...args: unknown[]) => RegisteredTool }).registerTool = (...args) => {
    const tool = register(...args);
    tools.set(args[0] as string, tool);
    return tool;
  };
  return tools;
}

export function registerAppViews(server: McpServer, deps: AppViewsDeps, registered: RegisteredTools, guarded: Guard): void {
  const uri = viewsResourceUri(deps.identity);

  registerAppResource(
    server,
    "Cost views",
    uri,
    { title: "Cost views", description: "Interactive cost, rollup and findings views for MCP Apps hosts.", mimeType: RESOURCE_MIME_TYPE },
    async () => ({
      contents: [
        { uri, mimeType: RESOURCE_MIME_TYPE, text: injectBrand(await deps.source.read(), toViewBrand(deps.identity, deps.version)) },
      ],
    }),
  );

  // Both the current key and the legacy flat key, as registerAppTool writes them.
  for (const name of APP_VIEW_TOOL_NAMES) {
    const tool = registered.get(name);
    if (tool) tool.update({ _meta: { ...tool._meta, ui: { resourceUri: uri }, [RESOURCE_URI_META_KEY]: uri } });
  }

  registerAppTool(
    server,
    "get_turn_series",
    {
      title: "Get a session's per-turn series",
      description:
        "App-only: the per-turn figures (AI Credits, input, cache read, output, events) behind a session's cost chart. Called by the cost view, not by the model; use get_session_cost for the model-facing summary.",
      inputSchema: {
        sessionId: sessionIdArg,
        provider: providerArg(deps.identity),
        maxTurns: z.number().int().min(1).max(MAX_TURNS_LIMIT).optional().describe(`How many turns to return, from the first (default ${DEFAULT_MAX_TURNS}, max ${MAX_TURNS_LIMIT}).`),
      },
      outputSchema: turnSeriesSchema,
      annotations: READ_ONLY,
      _meta: { ui: { visibility: ["app"] } },
    },
    ({ sessionId, provider, maxTurns }) =>
      guarded(async () => {
        const series = await deps.analysisQueries.getTurnSeries(sessionId, provider, maxTurns);
        return series ? json(series) : unknownSession(sessionId, provider);
      }),
  );
}
