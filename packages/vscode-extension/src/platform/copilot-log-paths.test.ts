import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copilotDebugLogsDirPaths, copilotLogPathsFromUserDataDir } from "./copilot-log-paths.js";

describe("copilotLogPathsFromUserDataDir (vscode-extension.md D4)", () => {
  let userDataDir: string;

  beforeEach(() => {
    userDataDir = mkdtempSync(path.join(tmpdir(), "copilot-log-paths-"));
  });

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true });
  });

  it("derives every Copilot log path from the user-data dir", () => {
    mkdirSync(path.join(userDataDir, "User", "workspaceStorage", "w1"), { recursive: true });
    mkdirSync(path.join(userDataDir, "User", "workspaceStorage", "w2"), { recursive: true });

    expect(copilotLogPathsFromUserDataDir(userDataDir)).toEqual({
      sessionStoreDbPath: path.join(userDataDir, "User", "globalStorage", "github.copilot-chat", "session-store.db"),
      debugLogsDirPaths: [
        path.join(userDataDir, "User", "workspaceStorage", "w1", "GitHub.copilot-chat", "debug-logs"),
        path.join(userDataDir, "User", "workspaceStorage", "w2", "GitHub.copilot-chat", "debug-logs"),
      ],
      agentTracesDbPath: path.join(userDataDir, "User", "globalStorage", "github.copilot-chat", "agent-traces.db"),
      vscodeSettingsPath: path.join(userDataDir, "User", "settings.json"),
    });
  });

  it("returns the file paths even before Copilot Chat has created the files (the provider opens them lazily)", () => {
    const paths = copilotLogPathsFromUserDataDir(userDataDir);

    expect(paths.sessionStoreDbPath).not.toBeNull();
    expect(paths.agentTracesDbPath).not.toBeNull();
    expect(paths.debugLogsDirPaths).toEqual([]);
  });

  it("says 'none' for every path when the user-data dir is unknown, instead of falling back to this machine's defaults", () => {
    expect(copilotLogPathsFromUserDataDir(null)).toEqual({
      sessionStoreDbPath: null,
      debugLogsDirPaths: [],
      agentTracesDbPath: null,
      vscodeSettingsPath: null,
    });
  });
});

describe("copilotDebugLogsDirPaths (re-listed on the sidebar's Refresh)", () => {
  let userDataDir: string;

  beforeEach(() => {
    userDataDir = mkdtempSync(path.join(tmpdir(), "copilot-debug-logs-paths-"));
  });

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true });
  });

  it("lists the workspaces that exist now, so one first opened later shows up on the next call", () => {
    expect(copilotDebugLogsDirPaths(userDataDir)).toEqual([]);

    mkdirSync(path.join(userDataDir, "User", "workspaceStorage", "w1"), { recursive: true });

    expect(copilotDebugLogsDirPaths(userDataDir)).toEqual([
      path.join(userDataDir, "User", "workspaceStorage", "w1", "GitHub.copilot-chat", "debug-logs"),
    ]);
  });

  it("is the same list copilotLogPathsFromUserDataDir starts with", () => {
    mkdirSync(path.join(userDataDir, "User", "workspaceStorage", "w1"), { recursive: true });

    expect(copilotLogPathsFromUserDataDir(userDataDir).debugLogsDirPaths).toEqual(copilotDebugLogsDirPaths(userDataDir));
  });

  it("is empty for an unknown user-data dir", () => {
    expect(copilotDebugLogsDirPaths(null)).toEqual([]);
  });
});
