import { LogProviderRegistry } from "../data-sources/log-providers/registry.js";
import type { AppSettingsStore } from "../data-sources/log-providers/app-settings.js";
import {
  createVscodeProvider,
  resolveVscodeSettingsPathOption,
  type VscodeProviderPaths,
} from "./providers/create-vscode-provider.js";

export interface CopilotProviderCompositionOptions extends VscodeProviderPaths {
  vscodeSettingsPath?: string | null;
  // The extension's own store (D5: its globalState), never the standalone
  // app's settings file, so neither product changes the other's settings.
  appSettings: AppSettingsStore;
}

// The extension's composition root (vscode-extension.md §3.1, G11): the
// VS Code / Copilot Chat provider only. It must not import any other
// provider's module, directly or transitively — the extension's
// bundle-boundary test fails the build if one leaks in.
export function composeCopilotProviders(options: CopilotProviderCompositionOptions) {
  const registry = new LogProviderRegistry([createVscodeProvider(options)], options.appSettings);

  return {
    registry,
    appSettings: options.appSettings,
    resolvedVscodeSettingsPath: resolveVscodeSettingsPathOption(options.vscodeSettingsPath),
  };
}
