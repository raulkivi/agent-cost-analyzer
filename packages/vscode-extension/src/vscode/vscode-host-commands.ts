import type { ReadOnlyDocumentStore } from "../documents/read-only-document-store.js";
import type { DocumentLanguage, HostCommands } from "../rpc/host-command-handler.js";
import { READ_ONLY_DOCUMENT_SCHEME } from "./vscode-read-only-documents.js";

// The slices of the `vscode` namespace the host commands need; extension.ts
// passes the real module, tests a fake.
export interface VscodeHostApi<Uri = unknown, Document = unknown> {
  commands: { executeCommand(command: string, ...args: unknown[]): PromiseLike<unknown> };
  env: { clipboard: { writeText(text: string): PromiseLike<void> } };
  Uri: { from(components: { scheme: string; path: string }): Uri };
  workspace: { openTextDocument(uri: Uri): PromiseLike<Document> };
  window: { showTextDocument(document: Document): PromiseLike<unknown> };
}

// Thin adapter: HostCommands (rpc/host-command-handler.ts, which validates
// everything first) over the real VS Code API. A document is read-only: its
// text is kept in the store, which the content provider of
// vscode-read-only-documents.ts serves, and it is opened by that URI. It is
// not an untitled editor, so it can't be edited or saved by accident.
export function createVscodeHostCommands<Uri, Document>(
  vscode: VscodeHostApi<Uri, Document>,
  documents: ReadOnlyDocumentStore,
): HostCommands {
  return {
    async openSetting(settingId: string) {
      await vscode.commands.executeCommand("workbench.action.openSettings", settingId);
    },
    async copyToClipboard(text: string) {
      await vscode.env.clipboard.writeText(text);
    },
    async openTextDocument(content: string, language: DocumentLanguage) {
      const path = documents.add(content, language);
      const document = await vscode.workspace.openTextDocument(vscode.Uri.from({ scheme: READ_ONLY_DOCUMENT_SCHEME, path }));
      await vscode.window.showTextDocument(document);
    },
  };
}
