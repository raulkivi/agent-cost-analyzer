import * as vscode from "vscode";
import type { WebviewPanelHandle, WebviewPanelOptions } from "../panel/analyzer-panel.js";

// Thin adapter: a real vscode.WebviewPanel behind the panel's own
// interfaces (panel/analyzer-panel.ts), which hold all the logic.
export function createVscodeWebviewPanel(options: WebviewPanelOptions): WebviewPanelHandle {
  const panel = vscode.window.createWebviewPanel(options.viewType, options.title, vscode.ViewColumn.Active, {
    enableScripts: options.enableScripts,
    localResourceRoots: options.localResourceRoots.map((root) => vscode.Uri.file(root)),
    retainContextWhenHidden: options.retainContextWhenHidden,
  });
  const { webview } = panel;
  return {
    webview: {
      get cspSource() {
        return webview.cspSource;
      },
      get html() {
        return webview.html;
      },
      set html(value: string) {
        webview.html = value;
      },
      asWebviewUri: (fsPath) => webview.asWebviewUri(vscode.Uri.file(fsPath)).toString(),
      postMessage: (message) => webview.postMessage(message),
      onDidReceiveMessage: (listener) => webview.onDidReceiveMessage(listener),
    },
    reveal: () => panel.reveal(),
    onDidChangeVisibility: (listener) => panel.onDidChangeViewState((event) => listener(event.webviewPanel.visible)),
    onDidDispose: (listener) => panel.onDidDispose(listener),
    dispose: () => panel.dispose(),
  };
}
