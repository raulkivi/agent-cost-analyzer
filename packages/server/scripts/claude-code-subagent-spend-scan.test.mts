// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_RUN_FILES } from "./claude-code-subagent-spend-lib.mjs";
import { listClaudeSessions, readOracleInput } from "./claude-code-subagent-spend-scan.mjs";

const NOW = Date.parse("2026-11-16T12:00:00Z");
const MINUTE = 60_000;

describe("Claude Code projects folder scan", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "cs16-scan-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const write = (file: string, text: string, ageMinutes = 120) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
    const at = new Date(NOW - ageMinutes * MINUTE);
    utimesSync(file, at, at);
  };
  const session = (project: string, id: string, ageMinutes = 120) => write(path.join(root, project, `${id}.jsonl`), "{}\n", ageMinutes);
  const sub = (project: string, id: string, name: string, text: string, ageMinutes = 120) => write(path.join(root, project, id, "subagents", name), text, ageMinutes);
  const line = (o: unknown) => `${JSON.stringify(o)}\n`;

  describe("listClaudeSessions", () => {
    it("lists a session per file and its subagent files, and calls a session live when any of them was written within 15 minutes", () => {
      session("p1", "old");
      session("p1", "live-main", 5);
      session("p2", "live-run");
      sub("p2", "live-run", "agent-aa1.jsonl", "{}\n", 3);
      session("p2", "quiet");
      sub("p2", "quiet", "agent-bb1.jsonl", "{}\n");
      sub("p2", "quiet", "agent-bb1.meta.json", "{}");

      const { stable, live } = listClaudeSessions(root, NOW);

      expect(stable.map((s) => `${s.project}/${s.sessionId}`)).toEqual(["p1/old", "p2/quiet"]);
      expect(live.map((s) => `${s.project}/${s.sessionId}`)).toEqual(["p1/live-main", "p2/live-run"]);
      expect(stable.find((s) => s.sessionId === "quiet")!.subagentFileCount).toBe(2);
      expect(stable.find((s) => s.sessionId === "old")!.files).toHaveLength(1);
    });

    it("ignores files that are not session logs and folders without any", () => {
      write(path.join(root, "p1", "notes.txt"), "x");
      mkdirSync(path.join(root, "empty"), { recursive: true });
      expect(listClaudeSessions(root, NOW)).toEqual({ stable: [], live: [] });
    });
  });

  describe("readOracleInput", () => {
    const read = (project: string, id: string, siblings: string[] = []) =>
      readOracleInput(
        path.join(root, project, `${id}.jsonl`),
        siblings.map((s) => path.join(root, project, `${s}.jsonl`)),
      );

    it("reads the session lines and each run's transcript and meta, keeping only the meta's two links", () => {
      session("p", "s1");
      writeFileSync(path.join(root, "p", "s1.jsonl"), line({ type: "user", uuid: "u1" }) + "not json\n" + line({ type: "assistant", uuid: "u2" }));
      sub("p", "s1", "agent-aa1.jsonl", line({ type: "user", agentId: "aa1" }) + '{"type":"assistant","trunc');
      sub("p", "s1", "agent-aa1.meta.json", JSON.stringify({ toolUseId: "toolu_1", parentAgentId: "zz9", description: "secret", worktreePath: "/x" }));

      const input = read("p", "s1");

      expect(input.lines.map((l) => l.uuid)).toEqual(["u1", "u2"]);
      expect(input.folder).toEqual({ status: "ok" });
      expect(input.runs).toEqual([
        { agentId: "aa1", meta: { toolUseId: "toolu_1", parentAgentId: "zz9" }, transcript: { status: "read", lines: [{ type: "user", agentId: "aa1" }] } },
      ]);
    });

    it("has no run and an ok folder when the session has no subagents folder", () => {
      session("p", "s1");
      expect(read("p", "s1")).toMatchObject({ folder: { status: "ok" }, runs: [] });
    });

    it("reports a meta with no transcript as missing, and ignores other names", () => {
      session("p", "s1");
      sub("p", "s1", "agent-aa1.meta.json", "{}");
      sub("p", "s1", "agent-aa1.forked-skill.json", "{}");
      sub("p", "s1", "notes.jsonl", "{}\n");
      const input = read("p", "s1");
      expect(input.runs).toEqual([{ agentId: "aa1", meta: {}, transcript: { status: "missing" } }]);
    });

    it("drops a meta that is too large, malformed or names an invalid id", () => {
      session("p", "s1");
      sub("p", "s1", "agent-aa1.jsonl", "{}\n");
      sub("p", "s1", "agent-aa1.meta.json", JSON.stringify({ toolUseId: "x".repeat(70_000) }));
      sub("p", "s1", "agent-bb1.jsonl", "{}\n");
      sub("p", "s1", "agent-bb1.meta.json", "{broken");
      sub("p", "s1", "agent-cc1.jsonl", "{}\n");
      sub("p", "s1", "agent-cc1.meta.json", JSON.stringify({ toolUseId: "has space", parentAgentId: "../x" }));
      const metas = read("p", "s1").runs.map((r) => [r.agentId, r.meta]);
      expect(metas).toEqual([["aa1", undefined], ["bb1", undefined], ["cc1", {}]]);
    });

    it("refuses a symlinked subagents folder and a symlinked transcript, never following them", () => {
      session("p", "s1");
      write(path.join(root, "elsewhere", "agent-aa1.jsonl"), line({ type: "user" }));
      mkdirSync(path.join(root, "p", "s1"), { recursive: true });
      symlinkSync(path.join(root, "elsewhere"), path.join(root, "p", "s1", "subagents"));
      expect(read("p", "s1").folder).toEqual({ status: "not-regular-folder" });

      session("p", "s2");
      mkdirSync(path.join(root, "p", "s2", "subagents"), { recursive: true });
      symlinkSync(path.join(root, "elsewhere", "agent-aa1.jsonl"), path.join(root, "p", "s2", "subagents", "agent-aa1.jsonl"));
      expect(read("p", "s2").runs).toEqual([{ agentId: "aa1", transcript: { status: "not-regular-file" } }]);
    });

    it("says too-many above the file cap, counting each run once however many files it has", () => {
      session("p", "s1");
      for (let i = 0; i < MAX_RUN_FILES; i += 1) sub("p", "s1", `agent-r${i}.jsonl`, "{}\n");
      expect(read("p", "s1").folder).toEqual({ status: "ok" });
      sub("p", "s1", `agent-r${MAX_RUN_FILES}.jsonl`, "{}\n");
      expect(read("p", "s1")).toMatchObject({ folder: { status: "too-many" }, runs: [] });
    });

    it("collects the call and agent ids other sessions of the same project hold", () => {
      session("p", "s1");
      session("p", "s2");
      sub("p", "s2", "agent-dd1.jsonl", "{}\n");
      sub("p", "s2", "agent-dd1.meta.json", JSON.stringify({ toolUseId: "toolu_9" }));
      session("q", "s3");
      sub("q", "s3", "agent-ee1.jsonl", "{}\n");
      const held = readOracleInput(path.join(root, "p", "s1.jsonl"), [path.join(root, "p", "s2.jsonl"), path.join(root, "q", "s3.jsonl")]).heldElsewhere;
      expect([...held!].sort()).toEqual(["dd1", "toolu_9"]);
    });
  });
});
