import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createCopilotMcpServices } from "@agent-cost-analyzer/server/src/composition/create-copilot-mcp-services";
import { resolveCopilotHome } from "@agent-cost-analyzer/server/src/data-sources/agent-host/copilot-cli-paths";
import { createMcpServer } from "@agent-cost-analyzer/server/src/mcp/mcp-server";
import { copilotDebugLogsDirPaths, copilotLogPathsFromUserDataDir } from "../platform/copilot-log-paths.js";

export interface CopilotMcpServerOptions {
  // VS Code's user-data dir, as the host derived it from globalStorageUri
  // (D4) and mcp-server-args.ts validated it.
  userDataDir: string;
  version: string;
  // The Copilot CLI's home (step 10.14); omitted, resolved as the CLI does,
  // from this process's environment, which the extension host passes on.
  copilotHome?: string | null;
}

// The MCP server the extension's child process runs (dist/mcp-stdio.js,
// vscode-extension.md D7): the standalone server's tools over the Copilot
// provider only, with every log path derived from the user-data dir the
// same way the extension host derives them (copilot-log-paths.ts). The
// process outlives many chats, so the per-workspace debug-logs folders are
// re-listed on every lookup, and a workspace opened later is still found.
export function createCopilotMcpServer({ userDataDir, version, copilotHome = resolveCopilotHome() }: CopilotMcpServerOptions): McpServer {
  const { sessionStoreDbPath, agentTracesDbPath, agentHostUserDataDir } = copilotLogPathsFromUserDataDir(userDataDir);
  return createMcpServer(
    createCopilotMcpServices({
      sessionStoreDbPath,
      agentTracesDbPath,
      agentHostUserDataDir,
      copilotHome,
      debugLogsDirPaths: () => copilotDebugLogsDirPaths(userDataDir),
      appVersion: version,
    }),
  );
}
