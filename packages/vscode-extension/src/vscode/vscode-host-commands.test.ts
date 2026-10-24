import { describe, expect, it, vi } from "vitest";
import { createVscodeHostCommands, type VscodeHostApi } from "./vscode-host-commands.js";

function fakeVscode() {
  const document = { uri: "untitled:Untitled-1" };
  const api = {
    commands: { executeCommand: vi.fn(async () => undefined) },
    env: { clipboard: { writeText: vi.fn(async () => undefined) } },
    workspace: { openTextDocument: vi.fn(async () => document) },
    window: { showTextDocument: vi.fn(async () => ({})) },
  } satisfies VscodeHostApi;
  return { api, document };
}

describe("createVscodeHostCommands (vscode-extension.md G8)", () => {
  it("opens the Settings editor on the setting id", async () => {
    const { api } = fakeVscode();

    await createVscodeHostCommands(api).openSetting("github.copilot.chat.agentDebugLog.fileLogging.enabled");

    expect(api.commands.executeCommand).toHaveBeenCalledWith(
      "workbench.action.openSettings",
      "github.copilot.chat.agentDebugLog.fileLogging.enabled",
    );
  });

  it("writes text to VS Code's clipboard", async () => {
    const { api } = fakeVscode();

    await createVscodeHostCommands(api).copyToClipboard("bundle");

    expect(api.env.clipboard.writeText).toHaveBeenCalledWith("bundle");
  });

  it("opens the text as an untitled document in the language and shows it", async () => {
    const { api, document } = fakeVscode();

    await createVscodeHostCommands(api).openTextDocument("You are a helpful assistant.", "plaintext");

    expect(api.workspace.openTextDocument).toHaveBeenCalledWith({
      content: "You are a helpful assistant.",
      language: "plaintext",
    });
    expect(api.window.showTextDocument).toHaveBeenCalledWith(document);
  });

  it("passes an editor failure on to the caller", async () => {
    const { api } = fakeVscode();
    api.env.clipboard.writeText.mockRejectedValueOnce(new Error("no clipboard"));

    await expect(createVscodeHostCommands(api).copyToClipboard("x")).rejects.toThrow("no clipboard");
  });
});
