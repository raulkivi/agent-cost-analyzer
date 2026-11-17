// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Unit tests of claude-subagent-runs-oracle.mts on small synthetic logs. Every
// expected figure is worked out by hand from the rules in the plan
// (docs/plans/claude-code-subagents.md §5.4, §6), not taken from the product.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { idsHeldByOtherSessions, placeRuns, readRunFolder, type PlaceInput, type RawRun } from "./claude-subagent-runs-oracle.mjs";
import type { RawLine } from "./savings-oracle.mjs";

const T0 = Date.parse("2026-10-20T10:00:00Z");
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

interface Usage {
  input: number;
  read: number;
  write: number;
  output: number;
  oneHour?: number;
}
const usageOf = (u: Usage | null) =>
  u === null
    ? {}
    : {
        usage: {
          input_tokens: u.input,
          cache_read_input_tokens: u.read,
          cache_creation_input_tokens: u.write,
          output_tokens: u.output,
          ...(u.oneHour !== undefined ? { cache_creation: { ephemeral_1h_input_tokens: u.oneHour } } : {}),
        },
      };

function round(id: string, minutes: number, u: Usage | null, model = "claude-sonnet-5-5", content: unknown[] = [], requestId = `req_${id}`): RawLine {
  return { type: "assistant", uuid: `l-${id}`, timestamp: at(minutes), requestId, message: { id, model, content, ...usageOf(u) } };
}
const call = (id: string): unknown => ({ type: "tool_use", id, name: "Agent", input: {} });
const result = (callId: string, minutes: number, extra: Record<string, unknown> = {}, isError = false): RawLine => ({
  type: "user",
  uuid: `r-${callId}`,
  timestamp: at(minutes),
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: callId, ...(isError ? { is_error: true } : {}) }] },
  ...extra,
});
const prompt = (id: string, minutes: number): RawLine => ({ type: "user", uuid: id, timestamp: at(minutes), message: { role: "user", content: "go" } });

const U = (n: number): Usage => ({ input: n, read: n * 10, write: n * 2, output: n * 3, oneHour: n * 2 });

// Two turns: turn 0 starts a run at minute 1, turn 1 opens at minute 10.
function session(): { branch: RawLine[]; turns: PlaceInput["turns"] } {
  const branch = [prompt("p0", 0), round("m1", 1, U(1), "claude-sonnet-5-5", [call("call-a")]), result("call-a", 2, { toolUseResult: { agentId: "aaa" } }), prompt("p1", 10), round("m2", 11, U(2))];
  return {
    branch,
    turns: [
      { index: 0, ms: T0 },
      { index: 3, ms: T0 + 10 * 60_000 },
    ],
  };
}
const runOf = (agentId: string, lines: RawLine[] | null, extra: Partial<RawRun> = {}): RawRun => ({ agentId, lines, ...extra });
const place = (runs: RawRun[], branch = session().branch, extra: Partial<PlaceInput> = {}) =>
  placeRuns({ branch, sessionLines: branch, turns: session().turns, runs, ...extra });

describe("placeRuns", () => {
  it("puts a run linked by meta.toolUseId whole on the turn that made the call, even if it ran later", () => {
    const out = place([runOf("aaa", [round("x1", 1, U(5), "claude-haiku-5-5"), round("x2", 12, U(7), "claude-haiku-5-5")], { toolUseId: "call-a" })]);
    expect(out.byTurn.get(0)!.runs).toEqual([
      { agentId: "aaa", turn: 0, model: "claude-haiku-5-5", rounds: 2, tokens: { uncached: 12, cacheRead: 120, cacheWrite: 24, output: 36, cacheWrite1h: 24 } },
    ]);
    expect(out.byTurn.get(0)!.unknown).toBe(false);
    expect(out.byTurn.has(1)).toBe(false);
    expect(out.runCount).toBe(1);
  });

  it("links by the call result's agentId when the meta names no call", () => {
    const out = place([runOf("aaa", [round("x1", 1, U(1))])]);
    expect(out.byTurn.get(0)!.runs).toHaveLength(1);
  });

  it("counts each message id once: a round repeated in the run, or copied from the session, is skipped", () => {
    const out = place([runOf("aaa", [round("x1", 3, U(1)), round("x1", 3, U(1)), round("m1", 1, U(1), "claude-sonnet-5-5", [], "req_m1"), round("x3", 4, U(1), "claude-sonnet-5-5", [], "req_m1")], { toolUseId: "call-a" })]);
    expect(out.byTurn.get(0)!.runs[0]!.rounds).toBe(1);
    expect(out.byTurn.get(0)!.runs[0]!.tokens!.uncached).toBe(1);
  });

  it("leaves out <synthetic> rounds", () => {
    const out = place([runOf("aaa", [round("x1", 3, U(1)), round("x2", 4, null, "<synthetic>")], { toolUseId: "call-a" })]);
    expect(out.byTurn.get(0)!.runs[0]!.rounds).toBe(1);
  });

  it("skips a nested fork's copies of its parent run's rounds, counted once in the parent", () => {
    const parent = runOf("aaa", [round("x1", 3, U(1)), round("x2", 4, U(2))], { toolUseId: "call-a" });
    const child = runOf("bbb", [round("x1", 3, U(1)), round("x2", 4, U(2)), round("y1", 5, U(4))], { parentAgentId: "aaa" });
    const out = place([child, parent]);
    const runs = out.byTurn.get(0)!.runs;
    expect(runs.map((r) => [r.agentId, r.rounds, r.tokens!.uncached])).toEqual(
      expect.arrayContaining([
        ["aaa", 2, 3],
        ["bbb", 1, 4],
      ]),
    );
    expect(out.runCount).toBe(2);
  });

  it("does not count a run whose Agent call is off the active branch", () => {
    const { branch } = session();
    const offBranch = [round("o1", 5, U(1), "claude-sonnet-5-5", [call("call-off")])];
    const own = runOf("aaa", [round("x1", 3, U(1))], { toolUseId: "call-a" });
    const out = place([own, runOf("ccc", [round("z1", 6, U(9))], { toolUseId: "call-off" })], branch, { sessionLines: [...branch, ...offBranch] });
    expect(out.byTurn.get(0)!.runs.map((r) => r.agentId)).toEqual(["aaa"]);
    expect(out.runCount).toBe(1);
    expect(out.sessionUnknown).toBe(false);
  });

  it("makes the turn unknown for a call that did not fail and has no run", () => {
    const out = place([]);
    expect(out.byTurn.get(0)).toEqual({ runs: [], unknown: true });
    expect(out.runCount).toBe(1);
  });

  it("keeps the turn known for a call that failed to launch", () => {
    const branch = [prompt("p0", 0), round("m1", 1, U(1), "claude-sonnet-5-5", [call("call-a")]), result("call-a", 2, {}, true)];
    const out = placeRuns({ branch, sessionLines: branch, turns: [{ index: 0, ms: T0 }], runs: [] });
    expect(out.byTurn.size).toBe(0);
  });

  it("keeps the turn known when another session of the project holds the call's run (D7)", () => {
    const out = place([], session().branch, { heldElsewhere: new Set(["call-a"]) });
    expect(out.byTurn.size).toBe(0);
  });

  it("makes the turn unknown when the transcript is missing, and when a round lacks a count", () => {
    expect(place([runOf("aaa", null, { toolUseId: "call-a" })]).byTurn.get(0)!.unknown).toBe(true);
    expect(place([runOf("aaa", [round("x1", 3, null)], { toolUseId: "call-a" })]).byTurn.get(0)!.unknown).toBe(true);
  });

  it("matches a run nothing names by the time of its first line to the one turn window that holds it", () => {
    const out = place([runOf("ddd", [round("w1", 12, U(3))])]);
    expect(out.byTurn.get(1)!.runs).toHaveLength(1);
  });

  it("makes the session unknown for a run nothing names that no window holds", () => {
    const out = place([runOf("ddd", [round("w1", -5, U(3))])]);
    expect(out.sessionUnknown).toBe(true);
    expect(place([runOf("ddd", null)]).sessionUnknown).toBe(true);
  });

  it("makes the run's turn unknown beyond depth 8 and the session unknown on a parent cycle", () => {
    const chain: RawRun[] = [runOf("r0", [round("c0", 3, U(1))], { toolUseId: "call-a" })];
    for (let i = 1; i <= 8; i++) chain.push(runOf(`r${i}`, [round(`c${i}`, 3, U(1))], { parentAgentId: `r${i - 1}` }));
    expect(place(chain).byTurn.get(0)!.unknown).toBe(true);
    const cycle = place([runOf("e1", [round("k1", 3, U(1))], { parentAgentId: "e2" }), runOf("e2", [round("k2", 3, U(1))], { parentAgentId: "e1" })]);
    expect(cycle.sessionUnknown).toBe(true);
  });

  it("leaves the 1-hour split unknown when a round with writes does not record it", () => {
    const out = place([runOf("aaa", [round("x1", 3, { input: 1, read: 1, write: 4, output: 1 })], { toolUseId: "call-a" })]);
    expect(out.byTurn.get(0)!.runs[0]!.tokens!.cacheWrite1h).toBeNull();
  });
});

describe("the subagents folder", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });
  const makeProject = (): string => {
    const root = mkdtempSync(path.join(tmpdir(), "runs-oracle-"));
    roots.push(root);
    return root;
  };
  const jsonl = (...lines: RawLine[]) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";

  it("reads a run's transcript and meta by their bare names and ignores every other file", () => {
    const root = makeProject();
    const dir = path.join(root, "s1", "subagents");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(root, "s1.jsonl"), "");
    writeFileSync(path.join(dir, "agent-aaa.jsonl"), jsonl(round("x1", 3, U(1))));
    writeFileSync(path.join(dir, "agent-aaa.meta.json"), JSON.stringify({ toolUseId: "call-a", parentAgentId: "zzz", description: "never read" }));
    writeFileSync(path.join(dir, "agent-aaa.forked-skill.json"), "{}");
    writeFileSync(path.join(dir, "agent-bbb.meta.json"), "{ not json");
    const runs = readRunFolder(path.join(root, "s1.jsonl"));
    expect(runs.map((r) => [r.agentId, r.toolUseId, r.parentAgentId, r.lines?.length ?? null])).toEqual([
      ["aaa", "call-a", "zzz", 1],
      ["bbb", undefined, undefined, null],
    ]);
  });

  it("treats a symbolic-link transcript as missing and a missing folder as no run", () => {
    const root = makeProject();
    const dir = path.join(root, "s1", "subagents");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(root, "real.jsonl"), jsonl(round("x1", 3, U(1))));
    symlinkSync(path.join(root, "real.jsonl"), path.join(dir, "agent-aaa.jsonl"));
    expect(readRunFolder(path.join(root, "s1.jsonl"))[0]!.lines).toBeNull();
    expect(readRunFolder(path.join(root, "none.jsonl"))).toEqual([]);
  });

  it("lists the call and agent ids that the project's other sessions hold", () => {
    const root = makeProject();
    for (const session of ["s1", "s2"]) writeFileSync(path.join(root, `${session}.jsonl`), "");
    const dir = path.join(root, "s2", "subagents");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "agent-aaa.meta.json"), JSON.stringify({ toolUseId: "call-a" }));
    expect([...idsHeldByOtherSessions(path.join(root, "s1.jsonl"))].sort()).toEqual(["aaa", "call-a"]);
    expect(idsHeldByOtherSessions(path.join(root, "s2.jsonl")).size).toBe(0);
  });
});
