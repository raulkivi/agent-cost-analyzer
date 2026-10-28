import type { AppSettingsStore } from "../data-sources/log-providers/app-settings.js";
import type { McpIdentity } from "../mcp/mcp-identity.js";
import type { McpServerDeps } from "../mcp/mcp-server.js";
import { composeCopilotProviders } from "./compose-copilot-providers.js";
import { createMcpServices } from "./mcp-services.js";
import type { VscodeProviderPaths } from "./providers/create-vscode-provider.js";

export interface CopilotMcpServicesOptions {
  // Every Copilot log path is explicit (the extension derives them from
  // VS Code's user-data dir, D4); null means "none", never this machine's
  // default install.
  sessionStoreDbPath: string | null;
  debugLogsDirPaths: NonNullable<VscodeProviderPaths["debugLogsDirPaths"]>;
  agentTracesDbPath: string | null;
  agentHostUserDataDir: string | null;
  appVersion: string;
}

// The extension's own name and Copilot-only wording (step 10.9): the same
// tools, but nothing about Claude Code, pi or mitmproxy, which this server
// can't read. The `provider` argument stays, because only "vscode" exists.
export const COPILOT_MCP_IDENTITY: McpIdentity = {
  name: "ai-credits-analyzer",
  instructions: [
    "Read-only analyzer of local GitHub Copilot Chat logs in VS Code (AI Credits Analyzer). It never writes, executes or reaches the network.",
    "Workflow: find a session with list_sessions (query/since/until), then drill in with get_session_cost (spend), get_session_audit and list_tool_calls (tool-call failures), and get_turn (one turn's prompt, response, usage and calls). For trends use get_cost_rollup, get_audit_rollup and list_findings (security, anomalies, behaviour changes).",
    'Scope: only the VS Code Copilot Chat provider ("vscode") is available here, so the `provider` argument can be left out (list_log_providers shows why a source has no sessions).',
    "Units: token counts are tokens; AI Credits are GitHub Copilot's billing unit. A null figure is unknown, never zero: check knownTurns vs turns and unavailableReasons before comparing. `estimated` marks local-tokenizer estimates.",
    "Dates are ISO (YYYY-MM-DD or a timestamp), inclusive, compared against each session's start.",
  ].join("\n\n"),
  logSourcesDescription: "VS Code GitHub Copilot Chat",
  providerArgDescription: 'Log provider id; only "vscode" (VS Code GitHub Copilot Chat) exists here, so this can be left out (see list_log_providers).',
};

const READ_ONLY_MESSAGE = "The MCP server doesn't change app settings";

// The MCP server only reads (architecture.md §11.2): it never switches the
// active provider or saves the retention threshold. So it gets a store with
// nothing persisted that refuses writes, rather than sharing the
// extension's globalState or the standalone app's settings file (D5).
const readOnlyAppSettings: AppSettingsStore = {
  readActiveProviderId: () => undefined,
  readMinRetainedSessionLogsThreshold: () => undefined,
  writeActiveProviderId: () => {
    throw new Error(READ_ONLY_MESSAGE);
  },
  writeMinRetainedSessionLogsThreshold: () => {
    throw new Error(READ_ONLY_MESSAGE);
  },
};

// The extension's MCP server (vscode-extension.md D7, step 10.8): the same
// tools and services as the standalone stdio server, over the Copilot-only
// composition root. Like compose-copilot-providers.ts it must not import
// any other provider's module; the extension's bundle-boundary test checks
// dist/mcp-stdio.js for that.
export function createCopilotMcpServices(options: CopilotMcpServicesOptions): McpServerDeps {
  const { registry } = composeCopilotProviders({
    sessionStoreDbPath: options.sessionStoreDbPath,
    debugLogsDirPaths: options.debugLogsDirPaths,
    agentTracesDbPath: options.agentTracesDbPath,
    agentHostUserDataDir: options.agentHostUserDataDir,
    // The config check isn't an MCP tool, so no settings.json is read.
    vscodeSettingsPath: null,
    appSettings: readOnlyAppSettings,
  });
  return createMcpServices(registry, options.appVersion, COPILOT_MCP_IDENTITY);
}
