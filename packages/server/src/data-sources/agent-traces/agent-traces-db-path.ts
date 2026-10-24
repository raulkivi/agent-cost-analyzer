import { resolveCopilotChatGlobalStorageFile } from "../sqlite/copilot-chat-global-storage-path.js";

interface ResolveAgentTracesDbPathOptions {
  platform?: NodeJS.Platform;
  homeDir?: string;
}

// agent-traces.db only exists once the user has enabled the optional VS Code
// setting github.copilot.chat.otel.dbSpanExporter.enabled and run at least
// one session since (non-retroactive, same caveat as the primary debug-log
// setting) — so returning null here is the expected, common case, not an
// error condition.
export function resolveAgentTracesDbPath(
  options: ResolveAgentTracesDbPathOptions = {},
): string | null {
  return resolveCopilotChatGlobalStorageFile("agent-traces.db", options);
}
