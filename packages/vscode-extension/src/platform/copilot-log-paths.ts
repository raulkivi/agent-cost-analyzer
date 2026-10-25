import { listWorkspaceDebugLogsDirPaths } from "@agent-cost-analyzer/server/src/data-sources/jsonl/session-log-path";
import { copilotChatGlobalStoragePath } from "@agent-cost-analyzer/server/src/data-sources/sqlite/copilot-chat-global-storage-path";
import { userSettingsFilePath } from "@agent-cost-analyzer/server/src/data-sources/vscode-settings/vscode-settings-path";

// The path options composeCopilotProviders takes, all derived from VS Code's
// user-data dir (D4). The standalone app's resolvers are reused so the
// layout (Copilot Chat's globalStorage, per-workspace debug-logs) lives in
// one place. Files are returned whether or not they exist yet: the provider
// opens them lazily, so a session store Copilot Chat creates after
// activation is still found. The workspace list is read now; copilotDebugLogsDirPaths
// below re-reads it.
export interface CopilotLogPaths {
  sessionStoreDbPath: string | null;
  debugLogsDirPaths: string[];
  agentTracesDbPath: string | null;
  vscodeSettingsPath: string | null;
}

// Just the per-workspace debug-logs folders, listed now: the sidebar's
// Refresh calls it again so a workspace first opened after activation is
// found without a reload. A null user-data dir has none.
export function copilotDebugLogsDirPaths(userDataDir: string | null): string[] {
  return userDataDir === null ? [] : listWorkspaceDebugLogsDirPaths({ userDataDir });
}

// A null user-data dir (an unrecognised globalStorageUri) means "none",
// never this machine's default install: the extension doesn't guess.
export function copilotLogPathsFromUserDataDir(userDataDir: string | null): CopilotLogPaths {
  if (userDataDir === null) {
    return { sessionStoreDbPath: null, debugLogsDirPaths: [], agentTracesDbPath: null, vscodeSettingsPath: null };
  }
  return {
    sessionStoreDbPath: copilotChatGlobalStoragePath(userDataDir, "session-store.db"),
    debugLogsDirPaths: copilotDebugLogsDirPaths(userDataDir),
    agentTracesDbPath: copilotChatGlobalStoragePath(userDataDir, "agent-traces.db"),
    vscodeSettingsPath: userSettingsFilePath(userDataDir),
  };
}
