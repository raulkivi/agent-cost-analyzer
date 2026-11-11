// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
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

// Copilot Chat writes a session's debug logs in one of two places, under
// <user-data-dir>/User/:
// - workspaceStorage/<workspace-hash>/GitHub.copilot-chat/debug-logs/<session-id>/
//   for a window with a folder open (confirmed against this machine's logs,
//   agentic-coding-explained.md §18.3/vision.md §4);
// - globalStorage/github.copilot-chat/debug-logs/<session-id>/ for a window
//   with no folder open (step 10.18; VS Code 1.145.0, Copilot Chat 0.73.0).
// A session id's location isn't known ahead of time, so every workspace
// subdirectory plus the global folder is a candidate; resolveMainJsonlPath
// below picks whichever one actually has the session. The global folder is
// listed last and whether or not it exists yet: the lookup is lazy.
export function listWorkspaceDebugLogsDirPaths(
  options: ListWorkspaceDebugLogsDirPathsOptions = {},
): string[] {
  const userDataDir = options.userDataDir ?? resolveUserDataDir(options);
  if (!userDataDir) {
    return [];
  }

  const globalDebugLogsDir = path.join(
    userDataDir,
    "User",
    "globalStorage",
    "github.copilot-chat",
    "debug-logs",
  );
  const workspaceStorageDir = path.join(userDataDir, "User", "workspaceStorage");
  if (!existsSync(workspaceStorageDir)) {
    return [globalDebugLogsDir];
  }

  const workspaceDirs = readdirSync(workspaceStorageDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) =>
      path.join(
        workspaceStorageDir,
        entry.name,
        "GitHub.copilot-chat",
        "debug-logs",
      ),
    );
  return [...workspaceDirs, globalDebugLogsDir];
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
