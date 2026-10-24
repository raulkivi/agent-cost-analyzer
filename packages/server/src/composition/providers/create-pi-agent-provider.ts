import { PiAgentLogProvider } from "../../data-sources/pi-agent/pi-agent-log-provider.js";
import { resolvePiAgentSessionsDir } from "../../platform/pi-agent-paths/resolve-pi-agent-sessions-dir.js";
import { resolvePiSystemPromptLogPath } from "../../platform/pi-agent-paths/resolve-pi-system-prompt-log-path.js";

export interface PiAgentProviderPaths {
  piAgentSessionsDirPath?: string | null;
  systemPromptLogPath?: string | null;
}

// Standalone app only (vscode-extension.md G11).
export function createPiAgentProvider(paths: PiAgentProviderPaths = {}): PiAgentLogProvider {
  return new PiAgentLogProvider({
    sessionsDirPath:
      paths.piAgentSessionsDirPath !== undefined ? paths.piAgentSessionsDirPath : resolvePiAgentSessionsDir(),
    systemPromptLogPath:
      paths.systemPromptLogPath !== undefined ? paths.systemPromptLogPath : resolvePiSystemPromptLogPath(),
  });
}
