import type { AppSettingsStore } from "../data-sources/log-providers/app-settings.js";
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
  appVersion: string;
}

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
    // The config check isn't an MCP tool, so no settings.json is read.
    vscodeSettingsPath: null,
    appSettings: readOnlyAppSettings,
  });
  return createMcpServices(registry, options.appVersion);
}
