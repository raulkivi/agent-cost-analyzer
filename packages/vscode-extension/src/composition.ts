import { readFileSync } from "node:fs";
import path from "node:path";
import type { HostEvent } from "@copilot-cost-analyzer/domain";
import { createExtensionApiService } from "@copilot-cost-analyzer/server/src/composition/create-extension-api-service";
import { ExtensionCommands } from "./commands/extension-commands.js";
import { watchConfigChanges, type ConfigurationChangeSource } from "./config/config-change-watcher.js";
import { AnalyzerPanel, type Disposable } from "./panel/analyzer-panel.js";
import { createNonce } from "./panel/nonce.js";
import { buildPanelHtml, type ViteManifest } from "./panel/panel-html.js";
import { HostCommandHandler, type HostCommands } from "./rpc/host-command-handler.js";
import { MessageDispatcher } from "./rpc/message-dispatcher.js";
import { copilotDebugLogsDirPaths, copilotLogPathsFromUserDataDir } from "./platform/copilot-log-paths.js";
import { userDataDirFromGlobalStorage } from "./platform/vscode-user-data-dir.js";
import { SidebarController } from "./sidebar/sidebar-controller.js";
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
  // What the editor does for the webview's host commands (G8):
  // vscode/vscode-host-commands.ts over the real API.
  hostCommands: HostCommands;
}

export interface ComposedExtension extends Disposable {
  // Every contributed command's handler, by command id: extension.ts
  // registers them with VS Code.
  commandHandlers: Record<string, (...args: unknown[]) => unknown>;
  // The data behind the Sessions and Setup views and the status bar:
  // extension.ts registers their views over it, and starts its first read.
  sidebar: SidebarController;
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
  hostCommands,
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
  // The per-workspace debug-logs folders are listed now and again on every
  // sidebar refresh, so a workspace first opened after activation is read
  // without a reload; the provider asks for the current list on each lookup.
  let debugLogsDirPaths = logPaths.debugLogsDirPaths;
  const api = createExtensionApiService({
    ...logPaths,
    debugLogsDirPaths: () => debugLogsDirPaths,
    appSettings: new GlobalStateAppSettingsStore(globalState, {
      onError: (setting, error) => console.error(`AI Credits Analyzer: could not save ${setting}`, error),
    }),
    settingsSource: new VscodeSettingsSource(workspace, logPaths.vscodeSettingsPath),
    learnScenariosFixturesDir: path.join(mediaDir, "learn-scenarios"),
    appVersion: extensionVersion,
  });
  const dispatcher = new MessageDispatcher(api, {
    onInternalError: (method, error) => console.error(`AI Credits Analyzer: ${method} failed`, error),
    // openSetting may only open what the current config status warns about
    // (plus the two Copilot logging settings).
    hostCommands: new HostCommandHandler(hostCommands, () => api.getConfigStatus(), {
      onInternalError: (command, error) => console.error(`AI Credits Analyzer: ${command} failed`, error),
    }),
  });
  const panel = new AnalyzerPanel({
    createPanel: createVscodeWebviewPanel,
    mediaDir,
    renderHtml: (context) => buildPanelHtml({ manifest: readManifest(mediaDir), nonce: createNonce(), ...context }),
    handleMessage: (message) => dispatcher.dispatch(message),
  });

  const sidebar = new SidebarController(
    {
      listSessions: () => api.listSessions(),
      getConfigStatus: () => api.getConfigStatus(),
      relistLogSources: () => {
        debugLogsDirPaths = copilotDebugLogsDirPaths(userDataDir);
      },
    },
    { onInternalError: (source, error) => console.error(`AI Credits Analyzer: ${source} failed`, error) },
  );
  const commands = new ExtensionCommands({
    panel,
    sidebar,
    hostCommands,
    readConfigStatus: () => api.getConfigStatus(),
  });

  // A change to either Copilot logging setting makes the webview re-fetch
  // the config status (plan §4's configChanged), and the Setup view and
  // status bar re-read it.
  const configWatch = watchConfigChanges(workspace, () => {
    panel.post({ kind: "event", name: "configChanged" } satisfies HostEvent);
    void sidebar.refreshConfig();
  });

  return {
    commandHandlers: commands.handlers(),
    sidebar,
    dispose: () => {
      configWatch.dispose();
      panel.dispose();
    },
  };
}
