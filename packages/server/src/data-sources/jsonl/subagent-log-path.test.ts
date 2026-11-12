// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listSubagentLogFiles,
  MAX_SUBAGENT_FILES_PER_SESSION,
  resolveSubagentLogPath,
  SUBAGENT_LOG_NAME,
} from "./subagent-log-path.js";

let root: string;
let sessionDir: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "subagent-log-path-test-"));
  sessionDir = path.join(root, "session-1");
  mkdirSync(sessionDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const touch = (name: string, dir = sessionDir) => writeFileSync(path.join(dir, name), "{}\n");

describe("SUBAGENT_LOG_NAME", () => {
  it.each(["runSubagent-Explore-call_abc123.jsonl", "searchSubagent-toolu_01AbC.jsonl", "runSubagent-default-call_x-y.jsonl"])(
    "accepts %s",
    (name) => expect(SUBAGENT_LOG_NAME.test(name)).toBe(true),
  );

  it.each([
    "main.jsonl",
    "runSubagent-.jsonl",
    "runSubagent-a.json",
    "xrunSubagent-a.jsonl",
    "runSubagent-a.jsonl.bak",
    "runSubagent-a/b.jsonl",
    "runSubagent-..jsonl\n",
    "other-call_x.jsonl",
  ])("rejects %s", (name) => expect(SUBAGENT_LOG_NAME.test(name)).toBe(false));
});

describe("resolveSubagentLogPath", () => {
  it("resolves a matching regular file in the session folder", () => {
    touch("runSubagent-Explore-call_a.jsonl");

    expect(resolveSubagentLogPath(sessionDir, "runSubagent-Explore-call_a.jsonl")).toEqual({
      status: "found",
      path: path.join(sessionDir, "runSubagent-Explore-call_a.jsonl"),
    });
  });

  it("reports a matching name with no file as missing", () => {
    expect(resolveSubagentLogPath(sessionDir, "searchSubagent-call_gone.jsonl")).toEqual({ status: "missing" });
  });

  it.each([
    ["../runSubagent-Explore-call_a.jsonl"],
    ["..\\runSubagent-Explore-call_a.jsonl"],
    ["sub/runSubagent-Explore-call_a.jsonl"],
    ["/etc/passwd"],
    ["/abs/runSubagent-Explore-call_a.jsonl"],
    ["C:\\runSubagent-Explore-call_a.jsonl"],
    [".."],
    [""],
    ["runSubagent-Explore-call_a.jsonl/"],
    ["runSubagent-Explore-call_a.jsonl\0.txt"],
  ])("refuses the path-like name %j without touching the file system", (name) => {
    expect(resolveSubagentLogPath(sessionDir, name)).toEqual({ status: "invalid-name" });
  });

  it.each(["main.jsonl", "agent-traces.db", "notes.jsonl", "runSubagent-a.txt"])("refuses the other name %s even if the file exists", (name) => {
    touch(name);

    expect(resolveSubagentLogPath(sessionDir, name)).toEqual({ status: "invalid-name" });
  });

  it("refuses a symlink, even one with a valid name pointing at a real file", () => {
    const target = path.join(root, "secret.jsonl");
    writeFileSync(target, "{}\n");
    symlinkSync(target, path.join(sessionDir, "runSubagent-Explore-call_link.jsonl"));

    expect(resolveSubagentLogPath(sessionDir, "runSubagent-Explore-call_link.jsonl")).toEqual({ status: "not-a-regular-file" });
  });

  it("refuses a dangling symlink as not a regular file, not as missing", () => {
    symlinkSync(path.join(root, "nowhere"), path.join(sessionDir, "searchSubagent-call_dangling.jsonl"));

    expect(resolveSubagentLogPath(sessionDir, "searchSubagent-call_dangling.jsonl")).toEqual({ status: "not-a-regular-file" });
  });

  it("refuses a directory with a matching name", () => {
    mkdirSync(path.join(sessionDir, "runSubagent-Explore-call_dir.jsonl"));

    expect(resolveSubagentLogPath(sessionDir, "runSubagent-Explore-call_dir.jsonl")).toEqual({ status: "not-a-regular-file" });
  });

  it("refuses a ref that names a sibling session folder", () => {
    const other = path.join(root, "other");
    mkdirSync(other);
    touch("runSubagent-Explore-call_a.jsonl", other);

    expect(resolveSubagentLogPath(sessionDir, "../other/runSubagent-Explore-call_a.jsonl")).toEqual({ status: "invalid-name" });
  });

  it.each([
    ["a workspace folder", ["workspaceStorage", "hash1", "GitHub.copilot-chat", "debug-logs", "sess-1"]],
    ["the global folder", ["globalStorage", "github.copilot-chat", "debug-logs", "sess-1"]],
  ])("resolves in %s", (_label, segments) => {
    const dir = path.join(root, "User", ...segments);
    mkdirSync(dir, { recursive: true });
    touch("main.jsonl", dir);
    touch("runSubagent-Explore-call_a.jsonl", dir);

    expect(resolveSubagentLogPath(dir, "runSubagent-Explore-call_a.jsonl")).toEqual({
      status: "found",
      path: path.join(dir, "runSubagent-Explore-call_a.jsonl"),
    });
  });
});

describe("listSubagentLogFiles", () => {
  it("lists only the matching names, sorted", () => {
    touch("main.jsonl");
    touch("searchSubagent-call_b.jsonl");
    touch("runSubagent-Explore-call_a.jsonl");
    touch("notes.txt");
    touch("runSubagent-a.json");

    expect(listSubagentLogFiles(sessionDir)).toEqual({
      fileNames: ["runSubagent-Explore-call_a.jsonl", "searchSubagent-call_b.jsonl"],
      tooMany: false,
    });
  });

  it("lists a symlink and a directory with a matching name, so resolving can report them instead of hiding them", () => {
    symlinkSync(path.join(root, "nowhere"), path.join(sessionDir, "runSubagent-Explore-call_link.jsonl"));
    mkdirSync(path.join(sessionDir, "searchSubagent-call_dir.jsonl"));

    expect(listSubagentLogFiles(sessionDir).fileNames).toEqual(["runSubagent-Explore-call_link.jsonl", "searchSubagent-call_dir.jsonl"]);
  });

  it("returns an empty list for a missing folder and for one without subagent files", () => {
    expect(listSubagentLogFiles(path.join(root, "nope"))).toEqual({ fileNames: [], tooMany: false });
    touch("main.jsonl");
    expect(listSubagentLogFiles(sessionDir)).toEqual({ fileNames: [], tooMany: false });
  });

  it("has a per-session cap of 200", () => {
    expect(MAX_SUBAGENT_FILES_PER_SESSION).toBe(200);
  });

  it("accepts exactly the cap", () => {
    for (let i = 0; i < MAX_SUBAGENT_FILES_PER_SESSION; i++) {
      touch(`runSubagent-Explore-call_${String(i).padStart(4, "0")}.jsonl`);
    }

    const listed = listSubagentLogFiles(sessionDir);

    expect(listed.tooMany).toBe(false);
    expect(listed.fileNames).toHaveLength(MAX_SUBAGENT_FILES_PER_SESSION);
  });

  it("flags more than the cap as tooMany, so the caller makes the total unknown, and returns no more than the cap", () => {
    for (let i = 0; i <= MAX_SUBAGENT_FILES_PER_SESSION; i++) {
      touch(`runSubagent-Explore-call_${String(i).padStart(4, "0")}.jsonl`);
    }

    const listed = listSubagentLogFiles(sessionDir);

    expect(listed.tooMany).toBe(true);
    expect(listed.fileNames).toHaveLength(MAX_SUBAGENT_FILES_PER_SESSION);
  });

  it.each([
    ["a workspace folder", ["workspaceStorage", "hash1", "GitHub.copilot-chat", "debug-logs", "sess-1"]],
    ["the global folder", ["globalStorage", "github.copilot-chat", "debug-logs", "sess-1"]],
  ])("lists in %s", (_label, segments) => {
    const dir = path.join(root, "User", ...segments);
    mkdirSync(dir, { recursive: true });
    touch("runSubagent-Plan-call_a.jsonl", dir);

    expect(listSubagentLogFiles(dir).fileNames).toEqual(["runSubagent-Plan-call_a.jsonl"]);
  });
});
