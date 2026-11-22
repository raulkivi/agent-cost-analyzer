// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The ST15 real-data check's oracle (subagent-tool-audit-oracle.mts) over
// hand-made logs. Each rule is the plan's (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/subagent-tool-audit.md §4, §6, §11),
// not the code's: a wrong helper fails here before it can agree with a wrong
// product.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  agentHostOracle,
  classicOracle,
  emptyCounts,
  type ChildFile,
  type OutcomeCounts,
} from "./subagent-tool-audit-oracle.mjs";

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));

describe("independence", () => {
  it("imports nothing", () => {
    const text = readFileSync(path.join(SCRIPTS, "subagent-tool-audit-oracle.mts"), "utf-8");
    expect([...text.matchAll(/(?:from|import)\s+"([^"]+)"/g)].map((m) => m[1])).toEqual([]);
  });
});

const jsonl = (lines: object[]) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
const user = (ts: number) => ({ type: "user_message", ts, attrs: { content: "x" } });
const call = (spanId: string, status: string | undefined, extra: Record<string, unknown> = {}, attrs: Record<string, unknown> = {}) => ({
  type: "tool_call",
  name: "read_file",
  spanId,
  ts: 1000,
  dur: 10,
  ...(status === undefined ? {} : { status }),
  ...extra,
  attrs,
});
const ref = (file: string | null, id: string | null, extra: Record<string, unknown> = {}, attrs: Record<string, unknown> = {}) => ({
  type: "child_session_ref",
  ts: 1000,
  ...extra,
  attrs: { childSessionId: id, childLogFile: file, label: "runSubagent-default", ...attrs },
});
const childText = (calls: object[], extra: object[] = [], parent = "S1", sid = "c1") =>
  jsonl([{ type: "session_start", sid, ts: 1500, attrs: { parentSessionId: parent, label: "runSubagent-default" } }, ...extra, ...calls]);
const files = (m: Record<string, ChildFile>) => ({
  names: Object.keys(m),
  read: (name: string): ChildFile => m[name] ?? { kind: "missing" },
});
const text = (t: string): ChildFile => ({ kind: "text", text: t });
const counts = (c: Partial<OutcomeCounts>): OutcomeCounts => ({ ...emptyCounts(), ...c });

describe("classic main-agent counts", () => {
  it("counts spans after the first prompt by status, with canceled apart", () => {
    const main = jsonl([
      call("pre", "ok"),
      user(1),
      call("a", "ok"),
      call("b", "error", {}, { error: "boom" }),
      call("c", "error", {}, { error: " Canceled " }),
      call("d", "weird"),
      call("e", undefined),
    ]);
    const r = classicOracle({ folderId: "S1", mainText: main, ...files({}) });
    expect(r.main).toEqual(counts({ toolCalls: 5, succeeded: 1, failed: 1, canceled: 1, unknown: 2 }));
    expect(r.runs).toEqual([]);
  });
});

describe("classic runs", () => {
  const main = (refs: object[]) => jsonl([user(1), call("m1", "ok"), ...refs]);

  it("reads a ref's run: identity from the ref, calls from the child file", () => {
    const f = files({
      "runSubagent-default-c1.jsonl": text(childText([call("x1", "ok"), call("x2", "error", {}, { error: "no" })])),
    });
    const r = classicOracle({ folderId: "S1", mainText: main([ref("runSubagent-default-c1.jsonl", "c1")]), ...f });
    expect(r.runs).toHaveLength(1);
    expect(r.runs[0]).toMatchObject({ runId: "c1", label: "runSubagent-default", counts: counts({ toolCalls: 2, succeeded: 1, failed: 1 }) });
    expect(r.runs[0]!.matchedByTime).toBe(false);
    expect(r.unreadRuns).toEqual([]);
  });

  it("a run that made no call is a known zero", () => {
    const f = files({ "runSubagent-default-c1.jsonl": text(childText([])) });
    const r = classicOracle({ folderId: "S1", mainText: main([ref("runSubagent-default-c1.jsonl", "c1")]), ...f });
    expect(r.runs[0]!.counts).toEqual(emptyCounts());
  });

  it("predicts an unread run for a ref without a file, a bad name, or an empty file", () => {
    const f = files({ "runSubagent-default-e1.jsonl": text("") });
    const r = classicOracle({
      folderId: "S1",
      mainText: main([ref("runSubagent-default-c1.jsonl", "c1"), ref("../x.jsonl", "c2"), ref("runSubagent-default-e1.jsonl", "e1")]),
      ...f,
    });
    expect(r.runs).toEqual([]);
    expect(r.unreadRuns.map((u) => [u.runId, u.cause])).toEqual([
      ["c1", "missing"],
      ["c2", "invalid-name"],
      ["e1", "empty"],
    ]);
  });

  it("counts a repeated ref once", () => {
    const f = files({ "runSubagent-default-c1.jsonl": text(childText([call("x1", "ok")])) });
    const r = classicOracle({
      folderId: "S1",
      mainText: main([ref("runSubagent-default-c1.jsonl", "c1"), ref("runSubagent-default-c1.jsonl", "c1")]),
      ...f,
    });
    expect(r.runs).toHaveLength(1);
  });

  it("leaves a ref before the first prompt unplaced, not unread", () => {
    const f = files({ "runSubagent-default-c1.jsonl": text(childText([call("x1", "ok")])) });
    const r = classicOracle({ folderId: "S1", mainText: jsonl([ref("runSubagent-default-c1.jsonl", "c1"), user(1)]), ...f });
    expect(r.runs).toEqual([]);
    expect(r.unreadRuns).toEqual([]);
    expect(r.unplaced).toBe(1);
  });

  it("counts a call id once: the parent's wins, then the first run's", () => {
    const f = files({
      "runSubagent-default-c1.jsonl": text(childText([call("m1", "ok"), call("x1", "ok")])),
      "runSubagent-default-c2.jsonl": text(childText([call("x1", "ok"), call("x2", "ok")], [], "S1", "c2")),
    });
    const r = classicOracle({
      folderId: "S1",
      mainText: main([ref("runSubagent-default-c1.jsonl", "c1"), ref("runSubagent-default-c2.jsonl", "c2")]),
      ...f,
    });
    expect(r.runs.map((x) => x.counts.toolCalls)).toEqual([1, 1]);
    expect(r.duplicateCallIds).toBe(2);
  });

  it("places an orphan file by time when it names this session, and marks it matched by time", () => {
    const f = files({ "searchSubagent-o1.jsonl": text(jsonl([{ type: "session_start", sid: "o1", ts: 1500, attrs: { parentSessionId: "S1", label: "searchSubagent" } }, call("x1", "ok")])) });
    const r = classicOracle({ folderId: "S1", mainText: main([]), ...f });
    expect(r.runs).toHaveLength(1);
    expect(r.runs[0]).toMatchObject({ runId: "o1", label: "searchSubagent", matchedByTime: true });
  });

  it("leaves an orphan of another session, or before the first prompt, unplaced", () => {
    const other = text(jsonl([{ type: "session_start", sid: "o1", ts: 1500, attrs: { parentSessionId: "OTHER", label: "searchSubagent" } }, call("x1", "ok")]));
    const early = text(jsonl([{ type: "session_start", sid: "o2", ts: 0, attrs: { parentSessionId: "S1", label: "searchSubagent" } }, call("x2", "ok")]));
    const r = classicOracle({ folderId: "S1", mainText: main([]), ...files({ "searchSubagent-o1.jsonl": other, "searchSubagent-o2.jsonl": early }) });
    expect(r.runs).toEqual([]);
    expect(r.unplaced).toBe(2);
  });

  it("reads no log and predicts every ref unread when the folder has too many subagent files", () => {
    const many: Record<string, ChildFile> = {};
    for (let i = 0; i < 201; i++) many[`searchSubagent-f${i}.jsonl`] = text(childText([call(`x${i}`, "ok")]));
    const r = classicOracle({ folderId: "S1", mainText: main([ref("searchSubagent-f0.jsonl", "f0")]), ...files(many) });
    expect(r.runs).toEqual([]);
    expect(r.unreadRuns.map((u) => u.cause)).toEqual(["too-many"]);
  });

  it("names the run a time window links, and an unclaimed subagent-kind call as an unlogged run", () => {
    const explore = (id: string, ts: number) => ({ type: "tool_call", name: "explore_subagent", spanId: id, ts, dur: 100, status: "ok", attrs: { args: '{"prompt":"find the thing in the repository please"}' } });
    const f = files({ "searchSubagent-s1.jsonl": text(childText([call("x1", "ok")], [], "S1", "s1")) });
    const r = classicOracle({
      folderId: "S1",
      mainText: jsonl([user(1), explore("e1", 1000), explore("e2", 5000), ref("searchSubagent-s1.jsonl", "s1", { ts: 1050 }, { label: "searchSubagent" })]),
      ...f,
    });
    expect(r.runs[0]).toMatchObject({ runId: "s1", matchedByTime: true });
    expect(r.unreadRuns).toEqual([{ runId: "e2", cause: "unlogged-call" }]);
    expect(r.subagentInputs).toContain("find the thing in the repository please");
  });

  it("does not match by time when the ref names its start call", () => {
    const f = files({ "runSubagent-default-c1.jsonl": text(childText([])) });
    const r = classicOracle({
      folderId: "S1",
      mainText: jsonl([user(1), { type: "tool_call", name: "runSubagent", spanId: "p1", ts: 1000, dur: 100, status: "ok", attrs: {} }, ref("runSubagent-default-c1.jsonl", "c1", { parentSpanId: "p1" })]),
      ...f,
    });
    expect(r.runs[0]!.matchedByTime).toBe(false);
    expect(r.unreadRuns).toEqual([]);
  });
});

describe("Agent Host", () => {
  const ev = (type: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ type, data, ...extra });
  const start = (id: string, parent?: string, agentId?: string) => ev("tool.execution_start", { toolCallId: id, toolName: "grep", ...(parent ? { parentToolCallId: parent } : {}) }, agentId ? { agentId } : {});
  const done = (id: string, success: boolean, agentId?: string) => ev("tool.execution_complete", { toolCallId: id, success }, agentId ? { agentId } : {});
  const prompt = ev("user.message", { content: "hi" });

  it("splits main and run calls by agentId and keys a run by its starting call", () => {
    const r = agentHostOracle([
      prompt,
      start("m1"),
      done("m1", true),
      start("task1"),
      done("task1", true),
      start("s1", "task1", "A"),
      done("s1", true, "A"),
      start("s2", "task1", "A"),
      done("s2", false, "A"),
    ]);
    expect(r.main).toEqual(counts({ toolCalls: 2, succeeded: 2 }));
    expect(r.runs).toEqual([{ runId: "task1", counts: counts({ toolCalls: 2, succeeded: 1, failed: 1 }), flagged: false }]);
  });

  it("denied wins over completion; no completion is interrupted in an aborted turn, else unknown", () => {
    const r = agentHostOracle([
      prompt,
      start("t"),
      start("a", "t", "A"),
      ev("permission.completed", { toolCallId: "a", result: { kind: "denied-by-user" } }, { agentId: "A" }),
      start("b", "t", "A"),
      ev("abort", {}),
      ev("user.message", { content: "again" }),
      start("c", "t", "A"),
    ]);
    expect(r.runs[0]!.counts).toEqual(counts({ toolCalls: 3, denied: 1, interrupted: 1, unknown: 1 }));
  });

  it("treats approved permissions as no effect", () => {
    const r = agentHostOracle([prompt, start("t"), start("a", "t", "A"), ev("permission.completed", { toolCallId: "a", result: { kind: "approved" } }, { agentId: "A" }), done("a", true, "A")]);
    expect(r.runs[0]!.counts).toEqual(counts({ toolCalls: 1, succeeded: 1 }));
  });

  it("flags a run whose starting call is not in the log, still counting its calls", () => {
    const r = agentHostOracle([prompt, start("s1", "gone", "A"), done("s1", true, "A")]);
    expect(r.runs).toEqual([{ runId: "gone", counts: counts({ toolCalls: 1, succeeded: 1 }), flagged: true }]);
  });

  it("keys a nested run by the call that started it, and counts a request without a start event", () => {
    const r = agentHostOracle([
      prompt,
      start("t"),
      start("inner-start", "t", "A"),
      start("deep", "inner-start", "B"),
      done("deep", true, "B"),
      ev("assistant.message", { toolRequests: [{ toolCallId: "req", name: "x" }] }),
    ]);
    expect(r.runs.map((x) => x.runId).sort()).toEqual(["inner-start", "t"]);
    expect(r.main.toolCalls).toBe(2);
  });

  it("collects the subagent-starting calls' input text, not other calls'", () => {
    const r = agentHostOracle([
      prompt,
      ev("tool.execution_start", { toolCallId: "t", toolName: "task", arguments: { prompt: "a long delegated prompt text here" } }),
      ev("tool.execution_start", { toolCallId: "g", toolName: "grep", arguments: { pattern: "a long search pattern string here" } }),
    ]);
    expect(r.subagentInputs).toEqual(["a long delegated prompt text here"]);
  });
});
