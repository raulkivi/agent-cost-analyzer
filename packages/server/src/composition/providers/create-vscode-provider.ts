import { resolveSessionStoreDbPath } from "../../data-sources/sqlite/session-store-path.js";
import { listWorkspaceDebugLogsDirPaths } from "../../data-sources/jsonl/session-log-path.js";
import { resolveAgentTracesDbPath } from "../../data-sources/agent-traces/agent-traces-db-path.js";
import { resolveVscodeSettingsPath } from "../../data-sources/vscode-settings/vscode-settings-path.js";
import { VscodeLogProvider } from "../../data-sources/log-providers/vscode/vscode-log-provider.js";
import { AgentHostSessionSource } from "../../data-sources/agent-host/agent-host-session-source.js";
import { resolveCopilotHome } from "../../data-sources/agent-host/copilot-cli-paths.js";
import { resolveUserDataDir } from "../../platform/vscode-paths/resolve-user-data-dir.js";

// Each path is overridable (tests, and the extension's VS Code-supplied
// paths, D4); an omitted one resolves to this machine's default, and an
// explicit null means "none".
export interface VscodeProviderPaths {
  sessionStoreDbPath?: string | null;
  // A function is asked on every lookup (see VscodeLogProviderOptions).
  debugLogsDirPaths?: string[] | (() => string[]);
  agentTracesDbPath?: string | null;
  // The VS Code user-data dir VS Code's Agent Host stores live under
  // (step 10.13): User/globalStorage/agent-host.db and
  // agentSessionData/<id>/session.db.
  agentHostUserDataDir?: string | null;
  // The Copilot CLI's home, where each Agent Host session's event log
  // lives (step 10.14). Omitted, it resolves as the CLI does (COPILOT_HOME,
  // else ~/.copilot), whichever product runs: the CLI, not VS Code, chose it.
  copilotHome?: string | null;
}

// The VS Code / Copilot Chat provider — the only one both products ship
// (vscode-extension.md G11).
export function createVscodeProvider(paths: VscodeProviderPaths = {}): VscodeLogProvider {
  return new VscodeLogProvider({
    sessionStoreDbPath: paths.sessionStoreDbPath !== undefined ? paths.sessionStoreDbPath : resolveSessionStoreDbPath(),
    debugLogsDirPaths: paths.debugLogsDirPaths ?? listWorkspaceDebugLogsDirPaths(),
    agentTracesDbPath: paths.agentTracesDbPath !== undefined ? paths.agentTracesDbPath : resolveAgentTracesDbPath(),
    agentHostSessions: agentHostSessionSource(
      paths.agentHostUserDataDir !== undefined ? paths.agentHostUserDataDir : resolveUserDataDir(),
      paths.copilotHome !== undefined ? paths.copilotHome : resolveCopilotHome(),
    ),
  });
}

// No user-data dir, no Agent Host sessions.
function agentHostSessionSource(userDataDir: string | null, copilotHome: string | null): AgentHostSessionSource | null {
  return userDataDir === null ? null : new AgentHostSessionSource({ userDataDir, copilotHome });
}

// The VS Code settings.json the config check reads: an explicit null means
// "none", so only undefined resolves the default.
export function resolveVscodeSettingsPathOption(vscodeSettingsPath: string | null | undefined): string | null {
  return vscodeSettingsPath !== undefined ? vscodeSettingsPath : resolveVscodeSettingsPath();
}
