import { readFileSync } from "node:fs";
import path from "node:path";
import type { HostEvent } from "@copilot-cost-analyzer/domain";
import { createExtensionApiService } from "@copilot-cost-analyzer/server/src/composition/create-extension-api-service";
import { watchConfigChanges, type ConfigurationChangeSource } from "./config/config-change-watcher.js";
import { AnalyzerPanel, type Disposable } from "./panel/analyzer-panel.js";
import { createNonce } from "./panel/nonce.js";
import { buildPanelHtml, type ViteManifest } from "./panel/panel-html.js";
import { MessageDispatcher } from "./rpc/message-dispatcher.js";
import { copilotLogPathsFromUserDataDir } from "./platform/copilot-log-paths.js";
import { userDataDirFromGlobalStorage } from "./platform/vscode-user-data-dir.js";
import { GlobalStateAppSettingsStore, type Memento } from "./settings/global-state-app-settings-store.js";
import { VscodeSettingsSource, type ConfigurationReader } from "./vscode/vscode-settings-source.js";
import { createVscodeWebviewPanel } from "./vscode/vscode-webview-panel.js";

export interface ExtensionCompositionInput {
  // The installed extension's root (context.extensionPath): dist/, media/.
  extensionPath: string;
  extensionVersion: string;
  // context.globalStorageUri.fsPath: where every Copilot log path is
  // derived from (D4).
  globalStoragePath: string;
  // context.globalState: the extension's own settings (D5).
  globalState: Memento;
  // vscode.workspace: the effective settings (G6) and their change events.
  workspace: ConfigurationReader & ConfigurationChangeSource;
}

export interface ComposedExtension extends Disposable {
  openPanel(): void;
}

function readManifest(mediaDir: string): ViteManifest {
  return JSON.parse(readFileSync(path.join(mediaDir, "manifest.json"), "utf-8")) as ViteManifest;
}

// The extension's composition root: the only place that constructs
// concrete classes. extension.ts calls it once on activation.
export function composeExtension({
  extensionPath,
  extensionVersion,
  globalStoragePath,
  globalState,
  workspace,
}: ExtensionCompositionInput): ComposedExtension {
  const mediaDir = path.join(extensionPath, "media");
  // Copilot only (vscode-extension.md §3.1). Every log path comes from the
  // user-data dir VS Code itself reports (D4); an unrecognised layout means
  // no Copilot data rather than a guess at this machine's defaults.
  const userDataDir = userDataDirFromGlobalStorage(globalStoragePath);
  if (userDataDir === null) {
    console.warn(`AI Credits Analyzer: unrecognised VS Code storage layout "${globalStoragePath}"; no Copilot logs will be read`);
  }
  const logPaths = copilotLogPathsFromUserDataDir(userDataDir);
  const api = createExtensionApiService({
    ...logPaths,
    appSettings: new GlobalStateAppSettingsStore(globalState, {
      onError: (setting, error) => console.error(`AI Credits Analyzer: could not save ${setting}`, error),
    }),
    settingsSource: new VscodeSettingsSource(workspace, logPaths.vscodeSettingsPath),
    learnScenariosFixturesDir: path.join(mediaDir, "learn-scenarios"),
    appVersion: extensionVersion,
  });
  const dispatcher = new MessageDispatcher(api, {
    onInternalError: (method, error) => console.error(`AI Credits Analyzer: ${method} failed`, error),
  });
  const panel = new AnalyzerPanel({
    createPanel: createVscodeWebviewPanel,
    mediaDir,
    renderHtml: (context) => buildPanelHtml({ manifest: readManifest(mediaDir), nonce: createNonce(), ...context }),
    handleMessage: (message) => dispatcher.dispatch(message),
  });

  // A change to either Copilot logging setting makes the webview re-fetch
  // the config status (plan §4's configChanged).
  const configWatch = watchConfigChanges(workspace, () =>
    panel.post({ kind: "event", name: "configChanged" } satisfies HostEvent),
  );

  return {
    openPanel: () => panel.open(),
    dispose: () => {
      configWatch.dispose();
      panel.dispose();
    },
  };
}
