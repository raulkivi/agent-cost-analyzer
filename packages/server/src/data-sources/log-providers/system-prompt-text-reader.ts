import type { LogProvider } from "./log-provider.js";

// The result of looking up a session's raw system-prompt text. Kept apart
// from a plain `string | null` because a provider may be able to tell an
// unknown session id apart from a known session that never captured a
// system prompt, and the API reports those two with different messages.
export type SystemPromptTextLookup =
  | { status: "found"; text: string }
  | { status: "not-captured" }
  | { status: "unknown-session" };

// Optional per-provider capability behind the "inspect as text" view
// (vscode-extension.md G1). Not part of LogProvider itself (ISP): only
// providers whose source keeps the assembled prompt implement it — VS Code
// (main.jsonl's system_prompt artifact) and pi-agent (in-file system
// messages or the sidecar log). mitmproxy and claude-code don't, and the
// API treats every session of theirs as unknown for this view, as before.
export interface SystemPromptTextReader {
  lookupSystemPromptText(sessionId: string): Promise<SystemPromptTextLookup>;
}

export function supportsSystemPromptText(provider: LogProvider): provider is LogProvider & SystemPromptTextReader {
  return typeof (provider as Partial<SystemPromptTextReader>).lookupSystemPromptText === "function";
}
