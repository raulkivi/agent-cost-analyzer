import { readFileSync } from "node:fs";
import path from "node:path";
import { createExtensionApiService } from "@copilot-cost-analyzer/server/src/composition/create-extension-api-service";
import { AnalyzerPanel, type Disposable } from "./panel/analyzer-panel.js";
import { createNonce } from "./panel/nonce.js";
import { buildPanelHtml, type ViteManifest } from "./panel/panel-html.js";
import { MessageDispatcher } from "./rpc/message-dispatcher.js";
import { SessionAppSettingsStore } from "./settings/session-app-settings-store.js";
import { createVscodeWebviewPanel } from "./vscode/vscode-webview-panel.js";

export interface ExtensionCompositionInput {
  // The installed extension's root (context.extensionPath): dist/, media/.
  extensionPath: string;
  extensionVersion: string;
}

export interface ComposedExtension extends Disposable {
  openPanel(): void;
}

function readManifest(mediaDir: string): ViteManifest {
  return JSON.parse(readFileSync(path.join(mediaDir, "manifest.json"), "utf-8")) as ViteManifest;
}

// The extension's composition root: the only place that constructs
// concrete classes. extension.ts calls it once on activation.
export function composeExtension({ extensionPath, extensionVersion }: ExtensionCompositionInput): ComposedExtension {
  const mediaDir = path.join(extensionPath, "media");
  // Copilot only (vscode-extension.md §3.1). Log and settings paths still
  // resolve to the standalone defaults; step 10.4 derives them from VS Code
  // (D4) and swaps in the globalState settings store (D5).
  const api = createExtensionApiService({
    appSettings: new SessionAppSettingsStore(),
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

  return {
    openPanel: () => panel.open(),
    dispose: () => panel.dispose(),
  };
}
