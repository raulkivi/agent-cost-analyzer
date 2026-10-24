import { describe, expect, it, vi } from "vitest";
import { ReadOnlyDocumentStore } from "../documents/read-only-document-store.js";
import { createVscodeHostCommands, type VscodeHostApi } from "./vscode-host-commands.js";

function fakeVscode() {
  const document = { uri: "ai-credits-analyzer-doc:/document-1.txt" };
  const api = {
    commands: { executeCommand: vi.fn(async () => undefined) },
    env: { clipboard: { writeText: vi.fn(async () => undefined) } },
    Uri: { from: vi.fn((components: { scheme: string; path: string }) => ({ ...components })) },
    workspace: { openTextDocument: vi.fn(async () => document) },
    window: { showTextDocument: vi.fn(async () => ({})) },
  } satisfies VscodeHostApi;
  return { api, document, store: new ReadOnlyDocumentStore() };
}

describe("createVscodeHostCommands (vscode-extension.md G8)", () => {
  it("opens the Settings editor on the setting id", async () => {
    const { api, store } = fakeVscode();

    await createVscodeHostCommands(api, store).openSetting("github.copilot.chat.agentDebugLog.fileLogging.enabled");

    expect(api.commands.executeCommand).toHaveBeenCalledWith(
      "workbench.action.openSettings",
      "github.copilot.chat.agentDebugLog.fileLogging.enabled",
    );
  });

  it("writes text to VS Code's clipboard", async () => {
    const { api, store } = fakeVscode();

    await createVscodeHostCommands(api, store).copyToClipboard("bundle");

    expect(api.env.clipboard.writeText).toHaveBeenCalledWith("bundle");
  });

  it("opens the text as a read-only document: stored, then opened by its URI, never as an untitled editor", async () => {
    const { api, document, store } = fakeVscode();

    await createVscodeHostCommands(api, store).openTextDocument("You are a helpful assistant.", "plaintext");

    const [{ scheme, path }] = api.Uri.from.mock.calls[0]!;
    expect(scheme).toBe("ai-credits-analyzer-doc");
    expect(store.get(path)).toBe("You are a helpful assistant.");
    expect(api.workspace.openTextDocument).toHaveBeenCalledWith({ scheme, path });
    expect(api.window.showTextDocument).toHaveBeenCalledWith(document);
  });

  it("opens each call as a document of its own, in the language's file type", async () => {
    const { api, store } = fakeVscode();
    const commands = createVscodeHostCommands(api, store);

    await commands.openTextDocument("# Advice", "markdown");
    await commands.openTextDocument("# Advice", "markdown");

    const paths = api.Uri.from.mock.calls.map(([components]) => components.path);
    expect(paths[0]).not.toBe(paths[1]);
    expect(paths[0]).toMatch(/\.md$/);
  });

  it("passes a failure of the size limit on to the caller, and opens nothing", async () => {
    const { api } = fakeVscode();
    const store = new ReadOnlyDocumentStore({ capacity: 1 });
    store.add = () => {
      throw new Error("too large");
    };

    await expect(createVscodeHostCommands(api, store).openTextDocument("x", "plaintext")).rejects.toThrow("too large");
    expect(api.workspace.openTextDocument).not.toHaveBeenCalled();
  });

  it("passes an editor failure on to the caller", async () => {
    const { api, store } = fakeVscode();
    api.env.clipboard.writeText.mockRejectedValueOnce(new Error("no clipboard"));

    await expect(createVscodeHostCommands(api, store).copyToClipboard("x")).rejects.toThrow("no clipboard");
  });
});
