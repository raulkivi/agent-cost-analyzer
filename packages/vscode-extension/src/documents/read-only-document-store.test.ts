import { MAX_HOST_COMMAND_TEXT_LENGTH } from "@copilot-cost-analyzer/domain";
import { describe, expect, it } from "vitest";
import { ReadOnlyDocumentStore } from "./read-only-document-store.js";

describe("ReadOnlyDocumentStore (vscode-extension.md §3.5, 10.5 hand-over)", () => {
  it("keeps the content under the path it returns", () => {
    const store = new ReadOnlyDocumentStore();

    const path = store.add("You are a helpful assistant.", "plaintext");

    expect(store.get(path)).toBe("You are a helpful assistant.");
  });

  it("gives every document its own path, even for the same content", () => {
    const store = new ReadOnlyDocumentStore();

    const first = store.add("same", "plaintext");
    const second = store.add("same", "plaintext");

    expect(first).not.toBe(second);
    expect(store.get(first)).toBe("same");
    expect(store.get(second)).toBe("same");
  });

  it("ends the path in the language's file extension, so the editor picks the language", () => {
    const store = new ReadOnlyDocumentStore();

    expect(store.add("a", "plaintext")).toMatch(/^\/[A-Za-z0-9-]+\.txt$/);
    expect(store.add("b", "markdown")).toMatch(/^\/[A-Za-z0-9-]+\.md$/);
    expect(store.add("c", "json")).toMatch(/^\/[A-Za-z0-9-]+\.json$/);
  });

  it("knows nothing about a path it never gave out", () => {
    const store = new ReadOnlyDocumentStore();

    expect(store.get("/document-1.txt")).toBeUndefined();
    expect(store.get("/../../etc/passwd")).toBeUndefined();
  });

  it("keeps at most 20 documents and evicts the oldest first", () => {
    const store = new ReadOnlyDocumentStore();
    const paths = Array.from({ length: 21 }, (_, index) => store.add(`content ${index}`, "plaintext"));

    expect(store.get(paths[0]!)).toBeUndefined();
    expect(paths.slice(1).map((path) => store.get(path))).toEqual(paths.slice(1).map((_, index) => `content ${index + 1}`));
    expect(store.size).toBe(20);
  });

  it("takes the capacity as an option", () => {
    const store = new ReadOnlyDocumentStore({ capacity: 2 });
    const [a, b, c] = ["a", "b", "c"].map((content) => store.add(content, "plaintext")) as [string, string, string];

    expect([store.get(a), store.get(b), store.get(c)]).toEqual([undefined, "b", "c"]);
  });

  it("never reuses the path of an evicted document for a new one", () => {
    const store = new ReadOnlyDocumentStore({ capacity: 1 });
    const first = store.add("first", "plaintext");
    const second = store.add("second", "plaintext");

    expect(second).not.toBe(first);
    expect(store.get(first)).toBeUndefined();
  });

  it("accepts content up to the host-command limit (5 Mi UTF-16 units) and refuses more, storing nothing", () => {
    const store = new ReadOnlyDocumentStore();

    const path = store.add("x".repeat(MAX_HOST_COMMAND_TEXT_LENGTH), "plaintext");
    expect(store.get(path)?.length).toBe(MAX_HOST_COMMAND_TEXT_LENGTH);

    expect(() => store.add("x".repeat(MAX_HOST_COMMAND_TEXT_LENGTH + 1), "plaintext")).toThrow(/too large/i);
    expect(store.size).toBe(1);
  });

  it("a refused document does not evict anything", () => {
    const store = new ReadOnlyDocumentStore({ capacity: 1 });
    const kept = store.add("kept", "plaintext");

    expect(() => store.add("x".repeat(MAX_HOST_COMMAND_TEXT_LENGTH + 1), "plaintext")).toThrow();

    expect(store.get(kept)).toBe("kept");
  });
});
