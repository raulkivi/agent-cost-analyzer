import { existsSync } from "node:fs";
import path from "node:path";
import { resolveUserDataDir } from "../../platform/vscode-paths/resolve-user-data-dir.js";

interface ResolveCopilotChatGlobalStorageFileOptions {
  platform?: NodeJS.Platform;
  homeDir?: string;
}

// Shared path construction for any file the GitHub Copilot Chat extension
// writes under its own globalStorage directory (session-store.db,
// agent-traces.db, ...) — one place so the directory segments can't drift
// between resolvers.
export function resolveCopilotChatGlobalStorageFile(
  fileName: string,
  options: ResolveCopilotChatGlobalStorageFileOptions = {},
): string | null {
  const userDataDir = resolveUserDataDir(options);
  if (!userDataDir) {
    return null;
  }

  const filePath = path.join(
    userDataDir,
    "User",
    "globalStorage",
    "github.copilot-chat",
    fileName,
  );
  return existsSync(filePath) ? filePath : null;
}
