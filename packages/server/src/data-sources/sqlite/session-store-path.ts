import { resolveCopilotChatGlobalStorageFile } from "./copilot-chat-global-storage-path.js";

interface ResolveSessionStoreDbPathOptions {
  platform?: NodeJS.Platform;
  homeDir?: string;
}

export function resolveSessionStoreDbPath(
  options: ResolveSessionStoreDbPathOptions = {},
): string | null {
  return resolveCopilotChatGlobalStorageFile("session-store.db", options);
}
