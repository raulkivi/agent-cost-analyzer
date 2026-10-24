import type { DocumentLanguage, HostCommands } from "../rpc/host-command-handler.js";

// The slices of the `vscode` namespace the host commands need; extension.ts
// passes the real module, tests a fake.
export interface VscodeHostApi<Document = unknown> {
  commands: { executeCommand(command: string, ...args: unknown[]): PromiseLike<unknown> };
  env: { clipboard: { writeText(text: string): PromiseLike<void> } };
  workspace: { openTextDocument(options: { content: string; language: string }): PromiseLike<Document> };
  window: { showTextDocument(document: Document): PromiseLike<unknown> };
}

// Thin adapter: HostCommands (rpc/host-command-handler.ts, which validates
// everything first) over the real VS Code API. The document is untitled:
// VS Code never saves it anywhere unless the user chooses to.
export function createVscodeHostCommands<Document>(vscode: VscodeHostApi<Document>): HostCommands {
  return {
    async openSetting(settingId: string) {
      await vscode.commands.executeCommand("workbench.action.openSettings", settingId);
    },
    async copyToClipboard(text: string) {
      await vscode.env.clipboard.writeText(text);
    },
    async openTextDocument(content: string, language: DocumentLanguage) {
      const document = await vscode.workspace.openTextDocument({ content, language });
      await vscode.window.showTextDocument(document);
    },
  };
}
