import { resolveAppSettingsDir } from "../platform/app-settings-dir/resolve-app-settings-dir.js";
import { migrateLegacyAppSettingsDir } from "../platform/app-settings-dir/migrate-legacy-app-settings-dir.js";
import { LogProviderRegistry } from "../data-sources/log-providers/registry.js";
import { FileAppSettingsStore } from "../data-sources/log-providers/app-settings.js";
import type { LogProvider } from "../data-sources/log-providers/log-provider.js";
import { createVscodeProvider, resolveVscodeSettingsPathOption } from "./providers/create-vscode-provider.js";
import { createMitmproxyProvider } from "./providers/create-mitmproxy-provider.js";
import { createPiAgentProvider } from "./providers/create-pi-agent-provider.js";
import { createClaudeCodeProvider } from "./providers/create-claude-code-provider.js";

export interface LogProviderCompositionOptions {
  sessionStoreDbPath?: string;
  debugLogsDirPaths?: string[];
  vscodeSettingsPath?: string | null;
  agentTracesDbPath?: string | null;
  appSettingsDir?: string;
  mitmproxyCapturesDirPath?: string | null;
  piAgentSessionsDirPath?: string | null;
  systemPromptLogPath?: string | null;
  claudeCodeProjectsDirPath?: string | null;
  // Additional providers registered alongside vscode/mitmproxy/pi-agent/claude-code — exists so
  // tests can prove the registry is open/closed (phase-9-log-providers-
  // implementation.md §8 step 9) without any other file needing to change.
  additionalLogProviders?: LogProvider[];
}

// The standalone app's composition root, shared by every entry point that
// reads sessions (the HTTP app's ApiService in
// create-standalone-api-service.ts and the stdio MCP server in
// mcp/stdio.ts): every provider, built by the same per-provider factories
// the extension's Copilot-only root (compose-copilot-providers.ts) uses,
// over the file-backed app settings. Each path is overridable for tests.
export function composeLogProviders(options: LogProviderCompositionOptions = {}) {
  const vscodeProvider = createVscodeProvider(options);
  const resolvedVscodeSettingsPath = resolveVscodeSettingsPathOption(options.vscodeSettingsPath);
  if (!options.appSettingsDir) {
    migrateLegacyAppSettingsDir();
  }
  const resolvedAppSettingsDir = options.appSettingsDir ?? resolveAppSettingsDir();

  const appSettings = new FileAppSettingsStore(resolvedAppSettingsDir);
  const registry = new LogProviderRegistry(
    [
      vscodeProvider,
      createMitmproxyProvider({ ...options, appSettingsDir: resolvedAppSettingsDir }),
      createPiAgentProvider(options),
      createClaudeCodeProvider(options),
      ...(options.additionalLogProviders ?? []),
    ],
    appSettings,
  );

  return {
    registry,
    appSettings,
    resolvedVscodeSettingsPath,
    resolvedAppSettingsDir,
  };
}
