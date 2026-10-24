import * as vscode from "vscode";
import { composeExtension } from "./composition.js";

const OPEN_COMMAND = "aiCreditsAnalyzer.open";

// Entry point (package.json "main" → dist/extension.js). Activation is
// implicit, on the first contributed command; everything is built by the
// composition root.
export function activate(context: vscode.ExtensionContext): void {
  const extension = composeExtension({
    extensionPath: context.extensionPath,
    extensionVersion: String((context.extension.packageJSON as { version: unknown }).version),
  });
  context.subscriptions.push(extension, vscode.commands.registerCommand(OPEN_COMMAND, () => extension.openPanel()));
}

// Everything is disposed through context.subscriptions.
export function deactivate(): void {}
