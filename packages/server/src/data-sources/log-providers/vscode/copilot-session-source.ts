import type { Session, TurnInspectorDetail } from "@agent-cost-analyzer/domain";
import type { LogProviderAvailability } from "../log-provider.js";
import type { SystemPromptTextLookup } from "../system-prompt-text-reader.js";

// One more store of Copilot sessions the VS Code provider lists next to the
// classic Copilot Chat session store (vscode-extension.md step 10.13: VS
// Code's Agent Host). The provider owns the id and label and stamps
// providerId; a source only reads its own store. Each method follows the
// matching LogProvider/SystemPromptTextReader contract, so null and
// "unknown-session" mean "not this source's session".
export interface CopilotSessionSource {
  checkAvailability(): Promise<LogProviderAvailability>;
  listSessions(): Promise<Session[]>;
  readSession(sessionId: string): Promise<Session | null>;
  readTurnDetail(sessionId: string, turnIndex: number): Promise<TurnInspectorDetail | null>;
  lookupSystemPromptText(sessionId: string): Promise<SystemPromptTextLookup>;
}
