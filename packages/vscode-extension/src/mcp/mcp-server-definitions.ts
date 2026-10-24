import path from "node:path";
import type { ConfigurationChangeSource } from "../config/config-change-watcher.js";
import type { Disposable } from "../panel/analyzer-panel.js";
import type { ConfigurationReader } from "../vscode/vscode-settings-source.js";
import { USER_DATA_DIR_FLAG } from "./mcp-server-args.js";

// The contributed mcpServerDefinitionProviders id and the setting that gates
// it (package.json; the manifest test keeps them in step).
export const MCP_PROVIDER_ID = "aiCreditsAnalyzer.mcp";
export const MCP_ENABLED_SETTING_ID = "aiCreditsAnalyzer.mcp.enabled";
export const MCP_SERVER_LABEL = "AI Credits Analyzer";

// The fields of a vscode.McpStdioServerDefinition, free of `vscode`; the
// adapter (vscode/vscode-mcp-server-definitions.ts) constructs the real one.
export interface McpStdioServerSpec {
  label: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  version: string;
}

export interface McpServerDefinitionInput {
  // The aiCreditsAnalyzer.mcp.enabled value as read; only `true` turns it on.
  enabled: unknown;
  // VS Code's user-data dir derived from globalStorageUri (D4), or null.
  userDataDir: string | null;
  extensionPath: string;
  // process.execPath in the extension host: VS Code's own Electron.
  execPath: string;
  version: string;
}

// What the extension offers VS Code (vscode-extension.md D7, step 10.8):
// nothing unless the user turned the setting on, because the server returns
// redacted session data to whichever model the chat uses (architecture.md
// §11.2). When on, one stdio server: dist/mcp-stdio.js run by VS Code's own
// Electron as Node, so no separate Node install is needed, given the
// user-data dir as its only argument. Without a user-data dir there's
// nothing to read, so nothing is offered.
export function mcpServerDefinitions(input: McpServerDefinitionInput): McpStdioServerSpec[] {
  if (input.enabled !== true || input.userDataDir === null) {
    return [];
  }
  return [
    {
      label: MCP_SERVER_LABEL,
      command: input.execPath,
      args: [path.join(input.extensionPath, "dist", "mcp-stdio.js"), USER_DATA_DIR_FLAG, input.userDataDir],
      env: { ELECTRON_RUN_AS_NODE: "1" },
      version: input.version,
    },
  ];
}

export interface McpServerDefinitionSourceDeps extends Omit<McpServerDefinitionInput, "enabled"> {
  // vscode.workspace: the setting's effective value and its change events.
  workspace: ConfigurationReader & ConfigurationChangeSource;
  onWarning(message: string): void;
}

// The definitions VS Code asks for, kept current: it reads the setting on
// every request and signals a change whenever the setting changes, so
// turning it on or off applies without a reload. An unknown user-data dir
// with the setting on is logged once, not on every request.
export class McpServerDefinitionSource implements Disposable {
  private readonly listeners = new Set<() => void>();
  private readonly configSubscription: Disposable;
  private warned = false;

  constructor(private readonly deps: McpServerDefinitionSourceDeps) {
    this.configSubscription = deps.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration(MCP_ENABLED_SETTING_ID)) {
        return;
      }
      for (const listener of [...this.listeners]) {
        listener();
      }
    });
  }

  onDidChange(listener: () => void): Disposable {
    this.listeners.add(listener);
    return { dispose: () => void this.listeners.delete(listener) };
  }

  provide(): McpStdioServerSpec[] {
    const enabled = this.deps.workspace.getConfiguration().get(MCP_ENABLED_SETTING_ID);
    if (enabled === true && this.deps.userDataDir === null && !this.warned) {
      this.warned = true;
      this.deps.onWarning("AI Credits Analyzer: the MCP server is on, but VS Code's user-data dir is unknown, so no server is offered");
    }
    const { userDataDir, extensionPath, execPath, version } = this.deps;
    return mcpServerDefinitions({ enabled, userDataDir, extensionPath, execPath, version });
  }

  dispose(): void {
    this.configSubscription.dispose();
    this.listeners.clear();
  }
}
