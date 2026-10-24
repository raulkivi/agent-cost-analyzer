import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveCopilotChatGlobalStorageFile } from "./copilot-chat-global-storage-path.js";

describe("resolveCopilotChatGlobalStorageFile", () => {
  let fakeHome: string;

  beforeEach(() => {
    fakeHome = mkdtempSync(path.join(tmpdir(), "copilot-chat-global-storage-path-test-"));
  });

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it("returns null when no VS Code install is present", () => {
    expect(
      resolveCopilotChatGlobalStorageFile("agent-traces.db", {
        platform: "linux",
        homeDir: fakeHome,
      }),
    ).toBeNull();
  });

  it("returns null when VS Code is installed but the named file doesn't exist yet", () => {
    mkdirSync(path.join(fakeHome, ".config", "Code - Insiders"), { recursive: true });

    expect(
      resolveCopilotChatGlobalStorageFile("agent-traces.db", {
        platform: "linux",
        homeDir: fakeHome,
      }),
    ).toBeNull();
  });

  it("returns the file's path when it exists under globalStorage/github.copilot-chat", () => {
    const globalStorageDir = path.join(
      fakeHome,
      ".config",
      "Code - Insiders",
      "User",
      "globalStorage",
      "github.copilot-chat",
    );
    mkdirSync(globalStorageDir, { recursive: true });
    const filePath = path.join(globalStorageDir, "agent-traces.db");
    writeFileSync(filePath, "");

    expect(
      resolveCopilotChatGlobalStorageFile("agent-traces.db", {
        platform: "linux",
        homeDir: fakeHome,
      }),
    ).toBe(filePath);
  });

  it("resolves different file names independently within the same directory", () => {
    const globalStorageDir = path.join(
      fakeHome,
      ".config",
      "Code - Insiders",
      "User",
      "globalStorage",
      "github.copilot-chat",
    );
    mkdirSync(globalStorageDir, { recursive: true });
    writeFileSync(path.join(globalStorageDir, "session-store.db"), "");

    expect(
      resolveCopilotChatGlobalStorageFile("agent-traces.db", {
        platform: "linux",
        homeDir: fakeHome,
      }),
    ).toBeNull();
    expect(
      resolveCopilotChatGlobalStorageFile("session-store.db", {
        platform: "linux",
        homeDir: fakeHome,
      }),
    ).toBe(path.join(globalStorageDir, "session-store.db"));
  });
});
