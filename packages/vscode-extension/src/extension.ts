import * as vscode from "vscode";
import { COMMAND_IDS, VIEW_IDS } from "./commands/command-ids.js";
import { composeExtension } from "./composition.js";
import { ReadOnlyDocumentStore } from "./documents/read-only-document-store.js";
import { registerReadOnlyDocuments } from "./vscode/vscode-read-only-documents.js";
import { createVscodeHostCommands } from "./vscode/vscode-host-commands.js";
import { registerMcpServerDefinitions } from "./vscode/vscode-mcp-server-definitions.js";
import { registerSessionsView, registerSetupView } from "./vscode/vscode-sidebar-views.js";
import { registerStatusBar } from "./vscode/vscode-status-bar.js";
import { createVscodeWalkthrough } from "./vscode/vscode-walkthrough.js";

// Entry point (package.json "main" → dist/extension.js). Activation is
// implicit, on the first contributed command or view, and on startup so the
// status bar has today's AI Credits; everything is built by the composition
// root.
export function activate(context: vscode.ExtensionContext): void {
  // The text of the read-only documents (system prompt, advice bundle) the
  // webview opens, served to the editor by a content provider.
  const documents = new ReadOnlyDocumentStore();
  const extension = composeExtension({
    extensionPath: context.extensionPath,
    extensionVersion: String((context.extension.packageJSON as { version: unknown }).version),
    execPath: process.execPath,
    globalStoragePath: context.globalStorageUri.fsPath,
    globalState: context.globalState,
    workspace: vscode.workspace,
    hostCommands: createVscodeHostCommands(vscode, documents),
    translate: vscode.l10n.t,
    walkthrough: createVscodeWalkthrough(vscode, context.extension.id),
  });
  context.subscriptions.push(extension, registerReadOnlyDocuments(vscode, documents));

  for (const [command, handler] of Object.entries(extension.commandHandlers)) {
    // The Refresh command shows progress on the Sessions view while it reads.
    const run =
      command === COMMAND_IDS.refreshSessions
        ? (...args: unknown[]) => vscode.window.withProgress({ location: { viewId: VIEW_IDS.sessions } }, async () => handler(...args))
        : handler;
    context.subscriptions.push(vscode.commands.registerCommand(command, run));
  }
  context.subscriptions.push(
    registerSessionsView<vscode.TreeItem>(vscode, extension.sidebar, vscode.l10n.t),
    registerSetupView<vscode.TreeItem>(vscode, extension.sidebar),
    registerStatusBar(vscode, extension.sidebar),
    // Offers VS Code the Copilot-only MCP server while its setting is on (D7).
    registerMcpServerDefinitions<vscode.McpStdioServerDefinition>(vscode, extension.mcpServers),
  );
  // The first read, so the status bar shows without a view being opened. It
  // never rejects: failures are shown by the views themselves.
  void extension.sidebar.refresh();
  // The Get Started walkthrough, once and without a notification.
  void extension.offerWalkthrough();
}

// Everything is disposed through context.subscriptions.
export function deactivate(): void {}
