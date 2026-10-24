import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isValidSessionId,
  listWorkspaceDebugLogsDirPaths,
  resolveMainJsonlPath,
} from "./session-log-path.js";

describe("listWorkspaceDebugLogsDirPaths", () => {
  let fakeHome: string;

  beforeEach(() => {
    fakeHome = mkdtempSync(path.join(tmpdir(), "session-log-path-test-"));
  });

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it("returns [] when no VS Code install is present", () => {
    expect(
      listWorkspaceDebugLogsDirPaths({ platform: "linux", homeDir: fakeHome }),
    ).toEqual([]);
  });

  it("returns [] when workspaceStorage doesn't exist yet", () => {
    mkdirSync(path.join(fakeHome, ".config", "Code - Insiders", "User"), {
      recursive: true,
    });

    expect(
      listWorkspaceDebugLogsDirPaths({ platform: "linux", homeDir: fakeHome }),
    ).toEqual([]);
  });

  it("returns one debug-logs dir per workspace-storage subdirectory (real logs live per-workspace, not in globalStorage)", () => {
    const workspaceStorageDir = path.join(
      fakeHome,
      ".config",
      "Code - Insiders",
      "User",
      "workspaceStorage",
    );
    mkdirSync(path.join(workspaceStorageDir, "hash1"), { recursive: true });
    mkdirSync(path.join(workspaceStorageDir, "hash2"), { recursive: true });

    const dirs = listWorkspaceDebugLogsDirPaths({
      platform: "linux",
      homeDir: fakeHome,
    });

    expect(dirs.sort()).toEqual(
      [
        path.join(workspaceStorageDir, "hash1", "GitHub.copilot-chat", "debug-logs"),
        path.join(workspaceStorageDir, "hash2", "GitHub.copilot-chat", "debug-logs"),
      ].sort(),
    );
  });
});

describe("isValidSessionId", () => {
  it("accepts UUID-shaped and simple alphanumeric-with-dashes ids", () => {
    expect(isValidSessionId("2137cba5-8ad3-4f7c-9a18-f8d716ed8683")).toBe(true);
    expect(isValidSessionId("session-1")).toBe(true);
  });

  it("rejects ids that could escape the debug-logs directory", () => {
    expect(isValidSessionId("../../etc/passwd")).toBe(false);
    expect(isValidSessionId("a/b")).toBe(false);
    expect(isValidSessionId("..")).toBe(false);
    expect(isValidSessionId("")).toBe(false);
  });
});

describe("resolveMainJsonlPath", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "session-log-path-resolve-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns the path from whichever candidate dir actually contains the session's main.jsonl", () => {
    const dirA = path.join(dir, "workspace-a", "debug-logs");
    const dirB = path.join(dir, "workspace-b", "debug-logs");
    const sessionDirB = path.join(dirB, "session-1");
    mkdirSync(sessionDirB, { recursive: true });
    writeFileSync(path.join(sessionDirB, "main.jsonl"), "");

    expect(resolveMainJsonlPath([dirA, dirB], "session-1")).toBe(
      path.join(sessionDirB, "main.jsonl"),
    );
  });

  it("returns null when no candidate dir contains the session", () => {
    const dirA = path.join(dir, "workspace-a", "debug-logs");
    mkdirSync(dirA, { recursive: true });

    expect(resolveMainJsonlPath([dirA], "session-1")).toBeNull();
  });

  it("returns null for an invalid session id", () => {
    expect(resolveMainJsonlPath([dir], "../etc/passwd")).toBeNull();
  });

  it("returns null when there are no candidate dirs", () => {
    expect(resolveMainJsonlPath([], "session-1")).toBeNull();
  });
});

describe("listWorkspaceDebugLogsDirPaths with an explicit userDataDir (vscode-extension.md D4)", () => {
  let userDataDir: string;

  beforeEach(() => {
    userDataDir = mkdtempSync(path.join(tmpdir(), "session-log-path-userdata-"));
  });

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true });
  });

  it("lists that dir's workspaces, ignoring the machine's default VS Code install", () => {
    mkdirSync(path.join(userDataDir, "User", "workspaceStorage", "abc"), { recursive: true });

    expect(listWorkspaceDebugLogsDirPaths({ userDataDir, platform: "darwin", homeDir: "/nonexistent" })).toEqual([
      path.join(userDataDir, "User", "workspaceStorage", "abc", "GitHub.copilot-chat", "debug-logs"),
    ]);
  });

  it("returns [] when it has no workspaceStorage yet", () => {
    expect(listWorkspaceDebugLogsDirPaths({ userDataDir })).toEqual([]);
  });
});
