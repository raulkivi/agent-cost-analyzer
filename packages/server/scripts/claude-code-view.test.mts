// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The real-data checks' view of the Claude Code projects folder
// (claude-code-view.mts), over a temporary folder standing in for it.
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildClaudeCodeView, createViewDir, viewParentDir } from "./claude-code-view.mjs";

const LIVE_MS = 15 * 60_000;
const NOW = Date.parse("2026-11-16T12:00:00Z");
const old = new Date(NOW - 3 * LIVE_MS);
const fresh = new Date(NOW - 60_000);

describe("buildClaudeCodeView", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });
  const setup = () => {
    const root = mkdtempSync(path.join(tmpdir(), "claude-view-"));
    roots.push(root);
    const source = path.join(root, "projects");
    mkdirSync(path.join(source, "p1"), { recursive: true });
    return { source, dir: path.join(root, "view") };
  };
  const write = (file: string, text: string, when: Date) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
    utimesSync(file, when, when);
  };

  it("copies a stable session file and its run files as real files in a real folder, keeping their write times", () => {
    const { source, dir } = setup();
    write(path.join(source, "p1", "s1.jsonl"), "session", old);
    write(path.join(source, "p1", "s1", "subagents", "agent-aaa.jsonl"), "run", old);
    write(path.join(source, "p1", "s1", "subagents", "agent-aaa.meta.json"), "{}", old);
    write(path.join(source, "p1", "s1", "subagents", "agent-aaa.forked-skill.json"), "{}", old);
    const view = buildClaudeCodeView(source, dir, NOW, LIVE_MS);
    const runDir = path.join(dir, "p1", "s1", "subagents");
    expect(view.files).toEqual([path.join(dir, "p1", "s1.jsonl")]);
    expect(lstatSync(view.files[0]!).isFile()).toBe(true);
    expect(readFileSync(view.files[0]!, "utf-8")).toBe("session");
    expect(statSync(view.files[0]!).mtimeMs).toBe(old.getTime());
    // A later append to the original does not reach the snapshot.
    writeFileSync(path.join(source, "p1", "s1.jsonl"), "session grown");
    expect(readFileSync(view.files[0]!, "utf-8")).toBe("session");
    expect(lstatSync(path.dirname(runDir)).isDirectory()).toBe(true);
    expect(readdirSync(runDir).sort()).toEqual(["agent-aaa.jsonl", "agent-aaa.meta.json"]);
    expect(lstatSync(path.join(runDir, "agent-aaa.jsonl")).isFile()).toBe(true);
    expect(readFileSync(path.join(runDir, "agent-aaa.jsonl"), "utf-8")).toBe("run");
    expect(view.targets).toHaveLength(3);
    expect(view.sessions.map((x) => [x.link, x.source, x.runSources.length])).toEqual([[view.files[0], path.join(source, "p1", "s1.jsonl"), 2]]);
    expect(view.live).toBe(0);
  });

  it("leaves out and counts a session whose file or whose run file was written within the live window", () => {
    const { source, dir } = setup();
    write(path.join(source, "p1", "live.jsonl"), "x", fresh);
    write(path.join(source, "p1", "busy.jsonl"), "x", old);
    write(path.join(source, "p1", "busy", "subagents", "agent-bbb.jsonl"), "x", fresh);
    write(path.join(source, "p1", "calm.jsonl"), "x", old);
    const view = buildClaudeCodeView(source, dir, NOW, LIVE_MS);
    expect(view.files.map((f) => path.basename(f))).toEqual(["calm.jsonl"]);
    expect(view.live).toBe(2);
  });

  it("gives a session with no subagents folder none, and skips non-session files", () => {
    const { source, dir } = setup();
    write(path.join(source, "p1", "s2.jsonl"), "x", old);
    write(path.join(source, "p1", "notes.txt"), "x", old);
    symlinkSync(path.join(source, "p1", "s2.jsonl"), path.join(source, "p1", "s3.txt"));
    const view = buildClaudeCodeView(source, dir, NOW, LIVE_MS);
    expect(view.files).toHaveLength(1);
    expect(readdirSync(path.join(dir, "p1"))).toEqual(["s2.jsonl"]);
  });

  it("returns an empty view for a source that does not exist", () => {
    const { dir } = setup();
    expect(buildClaudeCodeView(path.join(dir, "..", "nowhere"), dir, NOW, LIVE_MS)).toEqual({ dir, files: [], targets: [], sessions: [], live: 0 });
  });
});

describe("where a view lives (REAL_DATA_VIEW_PARENT, never RAM-backed tmpdir by default)", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("defaults to ~/.cache and takes REAL_DATA_VIEW_PARENT when set", () => {
    expect(viewParentDir({})).toBe(path.join(homedir(), ".cache"));
    expect(viewParentDir({ REAL_DATA_VIEW_PARENT: "/somewhere/else" })).toBe("/somewhere/else");
    expect(viewParentDir({ REAL_DATA_VIEW_PARENT: "" })).toBe(path.join(homedir(), ".cache"));
  });

  it("makes a fresh folder under the parent, creating the parent when it is missing", () => {
    const root = mkdtempSync(path.join(tmpdir(), "view-parent-"));
    roots.push(root);
    const parent = path.join(root, "not", "yet");
    const first = createViewDir("check-claude-", parent);
    const second = createViewDir("check-claude-", parent);
    expect(path.dirname(first)).toBe(parent);
    expect(first).not.toBe(second);
    expect(path.basename(first).startsWith("check-claude-")).toBe(true);
    expect(lstatSync(first).isDirectory()).toBe(true);
  });
});
