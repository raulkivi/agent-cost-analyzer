import { ClaudeCodeLogProvider } from "../../data-sources/claude-code/claude-code-log-provider.js";
import { resolveClaudeCodeProjectsDir } from "../../platform/claude-code-paths/resolve-claude-code-projects-dir.js";

export interface ClaudeCodeProviderPaths {
  claudeCodeProjectsDirPath?: string | null;
}

// Standalone app only (vscode-extension.md G11).
export function createClaudeCodeProvider(paths: ClaudeCodeProviderPaths = {}): ClaudeCodeLogProvider {
  return new ClaudeCodeLogProvider({
    projectsDirPath:
      paths.claudeCodeProjectsDirPath !== undefined ? paths.claudeCodeProjectsDirPath : resolveClaudeCodeProjectsDir(),
  });
}
