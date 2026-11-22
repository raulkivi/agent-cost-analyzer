// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The npm-package smoke's write-scope check (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/npm-package.md §4.4, §4.8 step
// 7): the fixture home before and after, and only the app's settings folder
// may change.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appSettingsDirIn, changesOutside, fixtureHomeEnv, snapshotTree, treeChanges } from "../smoke/home.mts";
import { resolveAppSettingsDir } from "../../server/src/platform/app-settings-dir/resolve-app-settings-dir.js";

describe("fixtureHomeEnv", () => {
  it("points every per-user folder the app or npm reads into the home", () => {
    expect(fixtureHomeEnv("/tmp/h", "linux")).toEqual({
      HOME: "/tmp/h",
      USERPROFILE: "/tmp/h",
      XDG_CONFIG_HOME: "/tmp/h/.config",
      APPDATA: "/tmp/h/AppData/Roaming",
      LOCALAPPDATA: "/tmp/h/AppData/Local",
    });
    expect(fixtureHomeEnv("C:\\t\\h", "win32")).toMatchObject({ APPDATA: "C:\\t\\h\\AppData\\Roaming", LOCALAPPDATA: "C:\\t\\h\\AppData\\Local" });
  });
});

describe("appSettingsDirIn", () => {
  it("is the app's own settings folder (resolveAppSettingsDir) under that environment, relative to the home", () => {
    for (const [platform, home] of [
      ["linux", "/tmp/h"],
      ["darwin", "/tmp/h"],
      ["win32", "C:\\t\\h"],
    ] as const) {
      const absolute = resolveAppSettingsDir({ platform, homeDir: home, env: fixtureHomeEnv(home, platform) });
      const relative = appSettingsDirIn(home, platform);
      expect(absolute.replaceAll("\\", "/"), platform).toBe(`${home.replaceAll("\\", "/")}/${relative}`);
    }
    expect(appSettingsDirIn("/tmp/h", "linux")).toBe(".config/agent-cost-analyzer");
    expect(appSettingsDirIn("/tmp/h", "darwin")).toBe("Library/Application Support/agent-cost-analyzer");
    expect(appSettingsDirIn("C:\\t\\h", "win32")).toBe("AppData/Roaming/agent-cost-analyzer");
  });
});

describe("treeChanges and changesOutside", () => {
  const before = new Map([
    [".config", "dir"],
    [".config/Code/User/settings.json", "file:aaa"],
    [".config/agent-cost-analyzer", "dir"],
    [".config/agent-cost-analyzer/projects.json", "file:bbb"],
    [".claude/projects/x.jsonl", "file:ccc"],
  ]);

  it("lists what was added, removed or changed, in path order", () => {
    const after = new Map(before);
    after.set(".config/agent-cost-analyzer/price-book.json", "file:ddd");
    after.set(".claude/projects/x.jsonl", "file:eee");
    after.delete(".config/Code/User/settings.json");
    expect(treeChanges(before, after)).toEqual([
      { path: ".claude/projects/x.jsonl", kind: "modified", directory: false },
      { path: ".config/Code/User/settings.json", kind: "removed", directory: false },
      { path: ".config/agent-cost-analyzer/price-book.json", kind: "added", directory: false },
    ]);
    expect(treeChanges(before, new Map(before))).toEqual([]);
  });

  it("allows changes inside the settings folder only", () => {
    const after = new Map(before);
    after.set(".config/agent-cost-analyzer/projects.json", "file:changed");
    after.set(".config/agent-cost-analyzer/sub", "dir");
    after.set(".config/agent-cost-analyzer/sub/file", "file:new");
    after.set(".config/agent-cost-analyzer-other/file", "file:new");
    after.set(".claude/projects/x.jsonl-wal", "file:new");
    expect(changesOutside(treeChanges(before, after), ".config/agent-cost-analyzer").map((change) => change.path)).toEqual([
      ".claude/projects/x.jsonl-wal",
      ".config/agent-cost-analyzer-other/file",
    ]);
  });

  it("allows creating the settings folder and its parent folders, but not a file in a parent", () => {
    const after = new Map([
      ["Library", "dir"],
      ["Library/Application Support", "dir"],
      ["Library/Application Support/agent-cost-analyzer", "dir"],
      ["Library/Application Support/agent-cost-analyzer/projects.json", "file:x"],
      ["Library/Application Support/notes.txt", "file:y"],
    ]);
    expect(changesOutside(treeChanges(new Map(), after), "Library/Application Support/agent-cost-analyzer")).toEqual([
      { path: "Library/Application Support/notes.txt", kind: "added", directory: false },
    ]);
  });

  it("allows removals inside the settings folder, but not of a parent folder", () => {
    const after = new Map(before);
    after.delete(".config/agent-cost-analyzer");
    after.delete(".config/agent-cost-analyzer/projects.json");
    expect(changesOutside(treeChanges(before, after), ".config/agent-cost-analyzer").map((change) => change.path)).toEqual([]);
    after.delete(".config");
    expect(changesOutside(treeChanges(before, after), ".config/agent-cost-analyzer")).toEqual([{ path: ".config", kind: "removed", directory: true }]);
  });
});

describe("snapshotTree", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "smoke-home-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("records every folder, every file by content and every link by target, with / separators", () => {
    mkdirSync(path.join(root, "a", "b"), { recursive: true });
    writeFileSync(path.join(root, "a", "b", "c.txt"), "one");
    writeFileSync(path.join(root, "top.json"), "{}");
    mkdirSync(path.join(root, "empty"));
    symlinkSync("top.json", path.join(root, "link"));
    const snapshot = snapshotTree(root);
    expect([...snapshot.keys()]).toEqual(["a", "a/b", "a/b/c.txt", "empty", "link", "top.json"]);
    expect(snapshot.get("a")).toBe("dir");
    expect(snapshot.get("link")).toBe("link:top.json");
    expect(snapshot.get("a/b/c.txt")).toMatch(/^file:[0-9a-f]{64}$/);
  });

  it("sees a change of content at the same size", () => {
    writeFileSync(path.join(root, "f"), "one");
    const before = snapshotTree(root);
    writeFileSync(path.join(root, "f"), "two");
    expect(treeChanges(before, snapshotTree(root))).toEqual([{ path: "f", kind: "modified", directory: false }]);
  });
});
