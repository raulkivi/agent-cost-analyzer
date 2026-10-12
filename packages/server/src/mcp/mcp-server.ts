import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LogProviderStatus } from "@copilot-cost-analyzer/domain";
import type { AnalysisQueryService } from "../services/analysis/analysis-query-service.js";
import type { AuditQueryService } from "../services/tool-audit/audit-query-service.js";
import { registerAuditTools } from "./audit-tools.js";
import { registerCostTools } from "./cost-tools.js";
import { registerFindingTools } from "./finding-tools.js";
import { registerPrompts } from "./prompts.js";
import { registerSessionTools } from "./session-tools.js";
import { createGuard } from "./tool-helpers.js";

// Local, read-only MCP interface over the analyzer (docs/plans/
// tool-call-audit.md §10, docs/plans/mcp-tools-v2.md) so a user can attach
// it to Claude Code or any MCP-capable harness and query their own
// sessions. Transport-agnostic: stdio.ts connects it over stdio; tests
// connect it in memory. Each tool group registers itself (open/closed).

export interface McpServerDeps {
  auditQueries: AuditQueryService;
  analysisQueries: AnalysisQueryService;
  getProviderStatus: () => Promise<LogProviderStatus>;
  version: string;
}

export const SERVER_INSTRUCTIONS = [
  "Read-only analyzer of local AI coding-agent logs (GitHub Copilot Chat in VS Code, Claude Code CLI, pi, mitmproxy captures). It never writes, executes or reaches the network.",
  "Workflow: find a session with list_sessions (query/since/until), then drill in with get_session_cost (spend), get_session_audit and list_tool_calls (tool-call failures), and get_turn (one turn's prompt, response, usage and calls). For trends use get_cost_rollup, get_audit_rollup and list_findings (security, anomalies, behaviour changes).",
  "Scope: per-session tools and get_audit_rollup read one provider, the `provider` argument or else the one active in the web app (list_log_providers shows activeProviderId). get_cost_rollup and list_findings read every available provider unless `provider` is given.",
  "Units: token counts are tokens; AI Credits are GitHub Copilot's billing unit and only VS Code sessions record them. A null figure is unknown, never zero: check knownTurns vs turns and unavailableReasons before comparing. `estimated` marks local-tokenizer estimates.",
  "Dates are ISO (YYYY-MM-DD or a timestamp), inclusive, compared against each session's start.",
].join("\n\n");

export function createMcpServer(deps: McpServerDeps): McpServer {
  const server = new McpServer({ name: "copilot-cost-analyzer", version: deps.version }, { instructions: SERVER_INSTRUCTIONS });
  const guarded = createGuard(deps.getProviderStatus);

  registerSessionTools(server, deps, guarded);
  registerAuditTools(server, deps, guarded);
  registerCostTools(server, deps, guarded);
  registerFindingTools(server, deps, guarded);
  registerPrompts(server);

  return server;
}
