import type { ReadOnlyDocumentStore } from "../documents/read-only-document-store.js";
import type { Disposable } from "../panel/analyzer-panel.js";

// The URI scheme of the read-only documents (a system prompt, an advice
// bundle). VS Code never lets the user edit a document a
// TextDocumentContentProvider supplies, and never saves it anywhere.
export const READ_ONLY_DOCUMENT_SCHEME = "ai-credits-analyzer-doc";

// The slice of the `vscode` namespace the provider needs; extension.ts
// passes the real module, tests a fake.
export interface VscodeReadOnlyDocumentsApi<Uri extends { path: string } = { path: string }> {
  workspace: {
    registerTextDocumentContentProvider(
      scheme: string,
      provider: { provideTextDocumentContent(uri: Uri): string },
    ): Disposable;
  };
}

// Thin adapter: serves the store's text to the editor for its scheme. A path
// the store no longer holds (dropped for newer documents) is an empty document.
export function registerReadOnlyDocuments<Uri extends { path: string }>(
  vscode: VscodeReadOnlyDocumentsApi<Uri>,
  store: ReadOnlyDocumentStore,
): Disposable {
  return vscode.workspace.registerTextDocumentContentProvider(READ_ONLY_DOCUMENT_SCHEME, {
    provideTextDocumentContent: (uri) => store.get(uri.path) ?? "",
  });
}
