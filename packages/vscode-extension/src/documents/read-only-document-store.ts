import { MAX_HOST_COMMAND_TEXT_LENGTH } from "@copilot-cost-analyzer/domain";
import type { DocumentLanguage } from "../rpc/host-command-handler.js";

// The file type the editor picks the document's language from.
const EXTENSIONS: Record<DocumentLanguage, string> = {
  plaintext: "txt",
  markdown: "md",
  json: "json",
};

const DEFAULT_CAPACITY = 20;

export interface ReadOnlyDocumentStoreOptions {
  // How many documents are kept; the oldest is dropped for a new one.
  capacity?: number;
}

// The text behind the read-only documents the webview opens (a system prompt,
// an advice bundle): a bounded in-memory map, free of `vscode`. The path
// `add` returns is the document's URI path under the content provider's
// scheme (vscode/vscode-read-only-documents.ts). A document the editor
// already opened keeps its text after it is dropped here; it is only read
// again if the editor asks for it anew.
export class ReadOnlyDocumentStore {
  // Insertion order is age: a Map iterates oldest first.
  private readonly documents = new Map<string, string>();
  private readonly capacity: number;
  private counter = 0;

  constructor(options: ReadOnlyDocumentStoreOptions = {}) {
    this.capacity = options.capacity ?? DEFAULT_CAPACITY;
  }

  get size(): number {
    return this.documents.size;
  }

  // Stores the text under a path of its own (never reused, so a stale link
  // can't show a newer document) and returns it. Text over the host-command
  // limit is refused before anything is dropped.
  add(content: string, language: DocumentLanguage): string {
    if (content.length > MAX_HOST_COMMAND_TEXT_LENGTH) {
      throw new Error(`The document is too large to open (over ${MAX_HOST_COMMAND_TEXT_LENGTH} characters)`);
    }
    this.counter += 1;
    const path = `/document-${this.counter}.${EXTENSIONS[language]}`;
    this.documents.set(path, content);
    while (this.documents.size > this.capacity) {
      this.documents.delete(this.documents.keys().next().value as string);
    }
    return path;
  }

  get(path: string): string | undefined {
    return this.documents.get(path);
  }
}
