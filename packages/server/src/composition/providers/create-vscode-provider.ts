import { resolveSessionStoreDbPath } from "../../data-sources/sqlite/session-store-path.js";
import { listWorkspaceDebugLogsDirPaths } from "../../data-sources/jsonl/session-log-path.js";
import { resolveAgentTracesDbPath } from "../../data-sources/agent-traces/agent-traces-db-path.js";
import { resolveVscodeSettingsPath } from "../../data-sources/vscode-settings/vscode-settings-path.js";
import { VscodeLogProvider } from "../../data-sources/log-providers/vscode/vscode-log-provider.js";

// Each path is overridable (tests, and the extension's VS Code-supplied
// paths, D4); an omitted one resolves to this machine's default, and an
// explicit null means "none".
export interface VscodeProviderPaths {
  sessionStoreDbPath?: string | null;
  // A function is asked on every lookup (see VscodeLogProviderOptions).
  debugLogsDirPaths?: string[] | (() => string[]);
  agentTracesDbPath?: string | null;
}

// The VS Code / Copilot Chat provider — the only one both products ship
// (vscode-extension.md G11).
export function createVscodeProvider(paths: VscodeProviderPaths = {}): VscodeLogProvider {
  return new VscodeLogProvider({
    sessionStoreDbPath: paths.sessionStoreDbPath !== undefined ? paths.sessionStoreDbPath : resolveSessionStoreDbPath(),
    debugLogsDirPaths: paths.debugLogsDirPaths ?? listWorkspaceDebugLogsDirPaths(),
    agentTracesDbPath: paths.agentTracesDbPath !== undefined ? paths.agentTracesDbPath : resolveAgentTracesDbPath(),
  });
}

// The VS Code settings.json the config check reads: an explicit null means
// "none", so only undefined resolves the default.
export function resolveVscodeSettingsPathOption(vscodeSettingsPath: string | null | undefined): string | null {
  return vscodeSettingsPath !== undefined ? vscodeSettingsPath : resolveVscodeSettingsPath();
}
