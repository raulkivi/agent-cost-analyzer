import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { resolveUserDataDir } from "../../platform/vscode-paths/resolve-user-data-dir.js";

interface ListWorkspaceDebugLogsDirPathsOptions {
  // A user-data dir known up front (the extension derives it from VS Code,
  // D4); when given, platform and homeDir are not consulted.
  userDataDir?: string;
  platform?: NodeJS.Platform;
  homeDir?: string;
}

// Allow-list: must not contain path separators or ".." segments, so a
// session id can never be used to escape a debug-logs directory (§11.2).
const SESSION_ID_PATTERN = /^[a-zA-Z0-9-]+$/;

// Real debug logs live per-workspace, under
// <user-data-dir>/User/workspaceStorage/<workspace-hash>/GitHub.copilot-chat/debug-logs/<session-id>/
// (confirmed against this machine's logs, and matches
// agentic-coding-explained.md §18.3/vision.md §4) — NOT under
// User/globalStorage/github.copilot-chat/debug-logs as originally assumed in
// Phase 4's first pass; globalStorage only holds session-store.db (§6.2).
// A session id's workspace hash isn't known ahead of time, so every
// workspace-storage subdirectory is a candidate; resolveMainJsonlPath below
// picks whichever one actually has the session.
export function listWorkspaceDebugLogsDirPaths(
  options: ListWorkspaceDebugLogsDirPathsOptions = {},
): string[] {
  const userDataDir = options.userDataDir ?? resolveUserDataDir(options);
  if (!userDataDir) {
    return [];
  }

  const workspaceStorageDir = path.join(userDataDir, "User", "workspaceStorage");
  if (!existsSync(workspaceStorageDir)) {
    return [];
  }

  return readdirSync(workspaceStorageDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) =>
      path.join(
        workspaceStorageDir,
        entry.name,
        "GitHub.copilot-chat",
        "debug-logs",
      ),
    );
}

export function isValidSessionId(sessionId: string): boolean {
  return SESSION_ID_PATTERN.test(sessionId);
}

// Tries each candidate debug-logs directory (one per workspace) and returns
// the first whose <sessionId>/main.jsonl actually exists on disk.
export function resolveMainJsonlPath(
  debugLogsDirPaths: string[],
  sessionId: string,
): string | null {
  if (!isValidSessionId(sessionId)) {
    return null;
  }

  for (const debugLogsDirPath of debugLogsDirPaths) {
    const candidate = path.join(debugLogsDirPath, sessionId, "main.jsonl");
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}
