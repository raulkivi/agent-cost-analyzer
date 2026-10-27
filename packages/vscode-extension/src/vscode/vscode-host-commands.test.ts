import { describe, expect, it, vi } from "vitest";
import { ReadOnlyDocumentStore } from "../documents/read-only-document-store.js";
import { createVscodeHostCommands, type VscodeHostApi } from "./vscode-host-commands.js";

const COPILOT_SETTING = "github.copilot.chat.agentDebugLog.fileLogging.enabled";

function fakeVscode({ registered = true, copilotChatInstalled = true } = {}) {
  const document = { uri: "ai-credits-analyzer-doc:/document-1.txt" };
  const api = {
    commands: { executeCommand: vi.fn(async () => undefined) },
    env: { clipboard: { writeText: vi.fn(async () => undefined) } },
    Uri: { from: vi.fn((components: { scheme: string; path: string }) => ({ ...components })) },
    workspace: {
      openTextDocument: vi.fn(async () => document),
      getConfiguration: vi.fn(() => ({
        inspect: vi.fn(() => ({ defaultValue: registered ? "default" : undefined })),
      })),
    },
    window: { showTextDocument: vi.fn(async () => ({})) },
    extensions: {
      getExtension: vi.fn(() => (copilotChatInstalled ? { id: "GitHub.copilot-chat" } : undefined)),
    },
  } satisfies VscodeHostApi;
  return { api, document, store: new ReadOnlyDocumentStore() };
}

describe("createVscodeHostCommands (vscode-extension.md G8)", () => {
  it("opens the Settings editor on an exact @id match for a registered setting", async () => {
    const { api, store } = fakeVscode();

    await createVscodeHostCommands(api, store).openSetting(COPILOT_SETTING);

    expect(api.commands.executeCommand).toHaveBeenCalledWith("workbench.action.openSettings", `@id:${COPILOT_SETTING}`);
  });

  it("opens the Settings editor on an exact @id match for a registered Copilot setting even when Copilot Chat is missing", async () => {
    const { api, store } = fakeVscode({ copilotChatInstalled: false });

    await createVscodeHostCommands(api, store).openSetting(COPILOT_SETTING);

    expect(api.commands.executeCommand).toHaveBeenCalledWith("workbench.action.openSettings", `@id:${COPILOT_SETTING}`);
  });

  it("opens the Extensions view on Copilot Chat when an unregistered Copilot setting's extension is disabled", async () => {
    const { api, store } = fakeVscode({ registered: false, copilotChatInstalled: false });

    await createVscodeHostCommands(api, store).openSetting(COPILOT_SETTING);

    expect(api.extensions.getExtension).toHaveBeenCalledWith("GitHub.copilot-chat");
    expect(api.commands.executeCommand).toHaveBeenCalledWith("workbench.extensions.search", "@id:GitHub.copilot-chat");
  });

  it("opens settings.json at the key for an unregistered Copilot setting while Copilot Chat is installed", async () => {
    const { api, store } = fakeVscode({ registered: false, copilotChatInstalled: true });

    await createVscodeHostCommands(api, store).openSetting(COPILOT_SETTING);

    expect(api.commands.executeCommand).toHaveBeenCalledWith("workbench.action.openSettingsJson", {
      revealSetting: { key: COPILOT_SETTING, edit: false },
    });
  });

  it("opens settings.json at the key for an unregistered non-Copilot setting, even when Copilot Chat is missing", async () => {
    const { api, store } = fakeVscode({ registered: false, copilotChatInstalled: false });

    await createVscodeHostCommands(api, store).openSetting("editor.fontSize");

    expect(api.commands.executeCommand).toHaveBeenCalledWith("workbench.action.openSettingsJson", {
      revealSetting: { key: "editor.fontSize", edit: false },
    });
    expect(api.commands.executeCommand).not.toHaveBeenCalledWith("workbench.extensions.search", expect.anything());
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
