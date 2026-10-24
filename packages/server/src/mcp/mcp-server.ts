import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LogProviderStatus } from "@copilot-cost-analyzer/domain";
import type { AnalysisQueryService } from "../services/analysis/analysis-query-service.js";
import type { AuditQueryService } from "../services/tool-audit/audit-query-service.js";
import { STANDALONE_MCP_IDENTITY, type McpIdentity } from "./mcp-identity.js";
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
  // The name and log-source wording of the product serving the tools;
  // defaults to the standalone server's (mcp-identity.ts).
  identity?: McpIdentity;
}

// Kept for the standalone server's callers; the wording lives in the identity.
export const SERVER_INSTRUCTIONS = STANDALONE_MCP_IDENTITY.instructions;

// What the tool groups see: the deps with the identity resolved.
export type McpToolDeps = McpServerDeps & { identity: McpIdentity };

export function createMcpServer(deps: McpServerDeps): McpServer {
  const identity = deps.identity ?? STANDALONE_MCP_IDENTITY;
  const toolDeps: McpToolDeps = { ...deps, identity };
  const server = new McpServer({ name: identity.name, version: deps.version }, { instructions: identity.instructions });
  const guarded = createGuard(deps.getProviderStatus);

  registerSessionTools(server, toolDeps, guarded);
  registerAuditTools(server, toolDeps, guarded);
  registerCostTools(server, toolDeps, guarded);
  registerFindingTools(server, toolDeps, guarded);
  registerPrompts(server);

  return server;
}
