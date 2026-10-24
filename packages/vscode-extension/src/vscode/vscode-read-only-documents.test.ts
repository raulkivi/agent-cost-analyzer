import { describe, expect, it } from "vitest";
import { ReadOnlyDocumentStore } from "../documents/read-only-document-store.js";
import { READ_ONLY_DOCUMENT_SCHEME, registerReadOnlyDocuments, type VscodeReadOnlyDocumentsApi } from "./vscode-read-only-documents.js";

function fakeVscode() {
  const registered: { scheme: string; provider: { provideTextDocumentContent(uri: { path: string }): string } }[] = [];
  const disposed: string[] = [];
  const api: VscodeReadOnlyDocumentsApi<{ path: string }> = {
    workspace: {
      registerTextDocumentContentProvider(scheme, provider) {
        registered.push({ scheme, provider });
        return { dispose: () => void disposed.push(scheme) };
      },
    },
  };
  return { api, registered, disposed };
}

describe("registerReadOnlyDocuments (vscode-extension.md §3.5, 10.5 hand-over)", () => {
  it("registers a content provider for its own scheme", () => {
    const { api, registered } = fakeVscode();

    registerReadOnlyDocuments(api, new ReadOnlyDocumentStore());

    expect(registered.map((entry) => entry.scheme)).toEqual([READ_ONLY_DOCUMENT_SCHEME]);
    expect(READ_ONLY_DOCUMENT_SCHEME).toBe("ai-credits-analyzer-doc");
  });

  it("serves the stored content for a path, and an empty document for one it doesn't know", () => {
    const { api, registered } = fakeVscode();
    const store = new ReadOnlyDocumentStore();
    registerReadOnlyDocuments(api, store);
    const path = store.add("prompt text", "plaintext");
    const { provider } = registered[0]!;

    expect(provider.provideTextDocumentContent({ path })).toBe("prompt text");
    expect(provider.provideTextDocumentContent({ path: "/gone.txt" })).toBe("");
  });

  it("unregisters the provider on dispose", () => {
    const { api, disposed } = fakeVscode();

    registerReadOnlyDocuments(api, new ReadOnlyDocumentStore()).dispose();

    expect(disposed).toEqual([READ_ONLY_DOCUMENT_SCHEME]);
  });
});
