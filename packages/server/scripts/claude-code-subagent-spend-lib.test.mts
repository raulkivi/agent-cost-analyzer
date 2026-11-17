// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { ModelTables } from "./savings-oracle.mjs";
import {
  MAX_RUN_DEPTH,
  MAX_RUN_FILES,
  oracleSession,
  pricedLines,
  pricedTurns,
  toolCallCounts,
  type OracleRunInput,
  type OracleSessionInput,
  type RawLine,
} from "./claude-code-subagent-spend-lib.mjs";

// ---- builders: raw Claude Code lines, as the CLI writes them ----

const T0 = Date.parse("2026-11-01T10:00:00Z");
const iso = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

interface Usage {
  input?: number;
  write?: number;
  read?: number;
  output?: number;
  oneHour?: number | null;
}

const usage = ({ input = 1, write = 10, read = 100, output = 5, oneHour = 4 }: Usage = {}) => ({
  input_tokens: input,
  cache_creation_input_tokens: write,
  cache_read_input_tokens: read,
  output_tokens: output,
  ...(oneHour === null ? {} : { cache_creation: { ephemeral_1h_input_tokens: oneHour, ephemeral_5m_input_tokens: write - oneHour } }),
});

let counter = 0;
const uuid = () => `u${(counter += 1)}`;

function user(parent: string | null, minutes: number, content: unknown = "do the thing please"): RawLine {
  return { type: "user", uuid: uuid(), parentUuid: parent, timestamp: iso(minutes), message: { role: "user", content } };
}

function assistant(parent: string, minutes: number, id: string, opts: { model?: string; usage?: unknown; blocks?: unknown[]; requestId?: string } = {}): RawLine {
  return {
    type: "assistant",
    uuid: uuid(),
    parentUuid: parent,
    timestamp: iso(minutes),
    requestId: opts.requestId ?? `req_${id}`,
    message: { id, model: opts.model ?? "claude-a", usage: "usage" in opts ? opts.usage : usage(), content: opts.blocks ?? [{ type: "text", text: "ok" }] },
  };
}

const agentCall = (callId: string, name = "Agent") => ({ type: "tool_use", id: callId, name, input: { prompt: "secret prompt text" } });
const toolUse = (callId: string, name = "Bash") => ({ type: "tool_use", id: callId, name, input: { command: "ls" } });

function result(parent: string, minutes: number, callId: string, extra: { agentId?: string; isError?: boolean } = {}): RawLine {
  return {
    type: "user",
    uuid: uuid(),
    parentUuid: parent,
    timestamp: iso(minutes),
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: callId, content: "done", ...(extra.isError ? { is_error: true } : {}) }] },
    ...(extra.agentId ? { toolUseResult: { agentId: extra.agentId } } : {}),
  };
}

interface Built {
  lines: RawLine[];
  last: string;
}

// One turn: the prompt, then one assistant line per block list (a round each).
function turn(prev: string | null, minutes: number, rounds: { id: string; blocks?: unknown[]; usage?: unknown; model?: string }[]): Built {
  const lines: RawLine[] = [];
  const prompt = user(prev, minutes);
  lines.push(prompt);
  let last = prompt.uuid as string;
  rounds.forEach((r, i) => {
    const a = assistant(last, minutes + 0.1 * (i + 1), r.id, { blocks: r.blocks, usage: r.usage ?? usage(), model: r.model });
    lines.push(a);
    last = a.uuid as string;
  });
  return { lines, last };
}

const run = (agentId: string, opts: { toolUseId?: string; parentAgentId?: string; lines?: RawLine[] } = {}): OracleRunInput => ({
  agentId,
  meta: { ...(opts.toolUseId ? { toolUseId: opts.toolUseId } : {}), ...(opts.parentAgentId ? { parentAgentId: opts.parentAgentId } : {}) },
  transcript: { status: "read", lines: opts.lines ?? [] },
});

// A run's transcript: one prompt line then one assistant line per round.
function transcript(agentId: string, minutes: number, rounds: { id: string; usage?: unknown; model?: string; requestId?: string; blocks?: unknown[] }[]): RawLine[] {
  const lines: RawLine[] = [{ type: "user", uuid: uuid(), parentUuid: null, isSidechain: true, agentId, timestamp: iso(minutes), message: { role: "user", content: "sub prompt text" } }];
  rounds.forEach((r, i) => {
    lines.push({ ...assistant(lines.at(-1)!.uuid as string, minutes + 0.1 * (i + 1), r.id, { usage: r.usage ?? usage(), model: r.model, requestId: r.requestId, blocks: r.blocks }), agentId, isSidechain: true });
  });
  return lines;
}

function input(lines: RawLine[], runs: OracleRunInput[] = [], extra: Partial<OracleSessionInput> = {}): OracleSessionInput {
  return { lines, folder: { status: "ok" }, runs, ...extra };
}

// A session with one main turn that starts a run through `Agent` call c1.
function oneTurnWithCall(callId = "c1", agentId?: string, failed = false): Built {
  const t = turn(null, 0, [{ id: "m1", blocks: [agentCall(callId)] }]);
  const r = result(t.last, 1, callId, { agentId, isError: failed });
  return { lines: [...t.lines, r], last: r.uuid as string };
}

describe("own usage", () => {
  it("counts each round once by message.id, however many lines carry it, and skips synthetic rounds", () => {
    const first = turn(null, 0, [{ id: "m1" }]);
    // A second content block of the same response repeats the usage.
    const block2 = assistant(first.last, 0.5, "m1");
    const synthetic = assistant(block2.uuid as string, 0.6, "m2", { model: "<synthetic>", usage: usage({ input: 0, write: 0, read: 0, output: 0, oneHour: 0 }) });
    const s = oracleSession(input([...first.lines, block2, synthetic]));
    expect(s.turns).toHaveLength(1);
    expect(s.turns[0]!.own).toEqual({ uncachedInput: 1, cacheWrite: 10, cacheRead: 100, output: 5, extendedCacheWrite: 4 });
    expect(s.turns[0]!.ownRounds).toBe(1);
    expect(s.turns[0]!.ownModel).toBe("claude-a");
  });

  it("takes the turn's model from its last round and leaves a session with no run known", () => {
    const t = turn(null, 0, [{ id: "m1", model: "claude-a" }, { id: "m2", model: "claude-b" }]);
    const s = oracleSession(input(t.lines));
    expect(s.turns[0]!.ownModel).toBe("claude-b");
    expect(s.unknownKinds).toEqual([]);
    expect(s.runs).toEqual([]);
  });

  it("reads the active branch: a call on an abandoned branch is not on it", () => {
    const first = turn(null, 0, [{ id: "m1" }]);
    const abandoned = turn(first.last, 1, [{ id: "m2", blocks: [agentCall("cx")] }]);
    const kept = turn(first.last, 2, [{ id: "m3" }]);
    const lines = [...first.lines, ...abandoned.lines, ...kept.lines, { type: "last-prompt", leafUuid: kept.last }];
    const s = oracleSession(input(lines, [run("aaa", { toolUseId: "cx", lines: transcript("aaa", 1.5, [{ id: "r1" }]) })]));
    expect(s.turns).toHaveLength(2);
    expect(s.offBranchRunIds).toEqual(["aaa"]);
    expect(s.runs).toEqual([]);
    expect(s.unknownKinds).toEqual([]);
  });
});

describe("linked runs", () => {
  it("sums a run's rounds once by message.id and places it on the turn of its Agent call", () => {
    const c = oneTurnWithCall("c1");
    const second = turn(c.last, 5, [{ id: "m2" }]);
    const r = run("aaa", {
      toolUseId: "c1",
      lines: [...transcript("aaa", 1, [{ id: "r1", usage: usage({ input: 2, write: 20, read: 200, output: 7, oneHour: 20 }), model: "claude-b" }, { id: "r2", usage: usage({ input: 3, write: 0, read: 300, output: 8, oneHour: 0 }), model: "claude-b" }]), assistant("x", 1.5, "r1", { usage: usage({ input: 2, write: 20, read: 200, output: 7, oneHour: 20 }) })],
    });
    const s = oracleSession(input([...c.lines, ...second.lines], [r]));
    expect(s.runs).toHaveLength(1);
    expect(s.runs[0]).toMatchObject({ agentId: "aaa", turn: 0, depth: 1, link: "tool-use-id", known: true, model: "claude-b", rounds: 2 });
    expect(s.runs[0]!.tokens).toEqual({ uncachedInput: 5, cacheWrite: 20, cacheRead: 500, output: 15, extendedCacheWrite: 20 });
    expect(s.turns[0]!.runs.map((x) => x.agentId)).toEqual(["aaa"]);
    expect(s.turns[1]!.runs).toEqual([]);
  });

  it("links a run by the call result's agentId when its meta names no call", () => {
    const c = oneTurnWithCall("c1", "aaa");
    const s = oracleSession(input(c.lines, [run("aaa", { lines: transcript("aaa", 1, [{ id: "r1" }]) })]));
    expect(s.runs[0]).toMatchObject({ agentId: "aaa", turn: 0, link: "tool-use-id" });
  });

  it("does not link through a result that names several results", () => {
    const t = turn(null, 0, [{ id: "m1", blocks: [agentCall("c1")] }]);
    const two: RawLine = {
      ...result(t.last, 1, "c1", { agentId: "aaa" }),
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "" }, { type: "tool_result", tool_use_id: "other", content: "" }] },
    };
    const s = oracleSession(input([...t.lines, two], [run("aaa", { lines: transcript("aaa", 99, [{ id: "r1" }]) })]));
    // Not linked by the result; the time of its first line is after the only turn's start.
    expect(s.runs[0]).toMatchObject({ agentId: "aaa", link: "timestamp" });
  });

  it("skips rounds a fork copied from the main branch, by message.id or by requestId", () => {
    const c = oneTurnWithCall("c1");
    const lines = transcript("aaa", 1, [
      { id: "m1" }, // the main agent's round, copied by message.id
      { id: "other", requestId: "req_m1" }, // copied by request id
      { id: "own", usage: usage({ input: 9, write: 0, read: 0, output: 1, oneHour: 0 }) },
    ]);
    const s = oracleSession(input(c.lines, [run("aaa", { toolUseId: "c1", lines })]));
    expect(s.runs[0]!.rounds).toBe(1);
    expect(s.runs[0]!.tokens.uncachedInput).toBe(9);
  });

  it("places a nested run on its top-level run's turn, with depth, and skips what a nested fork copied from its parent run", () => {
    const c = oneTurnWithCall("c1");
    const parent = run("aaa", { toolUseId: "c1", lines: transcript("aaa", 1, [{ id: "p1" }, { id: "p2" }]) });
    const child = run("bbb", { toolUseId: "inner", parentAgentId: "aaa", lines: transcript("bbb", 2, [{ id: "p1" }, { id: "c1" }]) });
    const s = oracleSession(input(c.lines, [child, parent]));
    const byId = new Map(s.runs.map((r) => [r.agentId, r]));
    expect(byId.get("aaa")).toMatchObject({ turn: 0, depth: 1, rounds: 2 });
    expect(byId.get("bbb")).toMatchObject({ turn: 0, depth: 2, parentAgentId: "aaa", rounds: 1 });
    expect(s.turns[0]!.runs.map((r) => r.agentId).sort()).toEqual(["aaa", "bbb"]);
  });

  it("makes a run unknown beyond depth 8 and on a parent cycle, never a smaller number", () => {
    const c = oneTurnWithCall("c1");
    const ids = Array.from({ length: MAX_RUN_DEPTH + 1 }, (_, i) => `r${i}`);
    const chain = ids.map((id, i) => run(id, { ...(i === 0 ? { toolUseId: "c1" } : { parentAgentId: ids[i - 1]! }), lines: transcript(id, 1 + i, [{ id: `x${i}` }]) }));
    const deep = oracleSession(input(c.lines, chain));
    expect(deep.runs.find((r) => r.agentId === `r${MAX_RUN_DEPTH - 1}`)!.known).toBe(true);
    expect(deep.runs.find((r) => r.agentId === `r${MAX_RUN_DEPTH}`)).toMatchObject({ known: false, unknownKind: "too-deep" });
    expect(deep.unknownKinds).toContain("too-deep");

    const plain = turn(null, 0, [{ id: "m1" }]);
    const loop = oracleSession(input(plain.lines, [run("a1", { parentAgentId: "b1", lines: transcript("a1", 1, [{ id: "y1" }]) }), run("b1", { parentAgentId: "a1", lines: transcript("b1", 1, [{ id: "y2" }]) })]));
    expect(loop.runs).toEqual([]);
    expect(loop.unknownKinds).toContain("too-deep");
  });

  it("treats a run missing its numeric usage field as unknown, with its other figures unknown too", () => {
    const c = oneTurnWithCall("c1");
    const lines = transcript("aaa", 1, [{ id: "r1", usage: { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 1 } }]);
    const s = oracleSession(input(c.lines, [run("aaa", { toolUseId: "c1", lines })]));
    expect(s.runs[0]).toMatchObject({ known: false, unknownKind: "missing-field" });
    expect(s.runs[0]!.tokens).toEqual({ uncachedInput: null, cacheWrite: null, cacheRead: null, output: null, extendedCacheWrite: null });
    expect(s.turns[0]!.total.output).toBeNull();
  });

  it("knows the 1-hour split only where the round gives it or wrote nothing", () => {
    const c = oneTurnWithCall("c1");
    const unsplit = transcript("aaa", 1, [{ id: "r1", usage: usage({ write: 10, oneHour: null }) }]);
    const s = oracleSession(input(c.lines, [run("aaa", { toolUseId: "c1", lines: unsplit })]));
    expect(s.runs[0]!.known).toBe(true);
    expect(s.runs[0]!.tokens.extendedCacheWrite).toBeNull();
    const nothing = transcript("bbb", 1, [{ id: "r2", usage: usage({ write: 0, oneHour: null }) }]);
    const t = oracleSession(input(c.lines, [run("bbb", { toolUseId: "c1", lines: nothing })]));
    expect(t.runs[0]!.tokens.extendedCacheWrite).toBe(0);
  });
});

describe("unknown, never 0", () => {
  it("stands an unknown run on the turn of a call whose transcript is missing", () => {
    const c = oneTurnWithCall("c1");
    const s = oracleSession(input(c.lines, [{ agentId: "aaa", meta: { toolUseId: "c1" }, transcript: { status: "missing" } }]));
    expect(s.runs[0]).toMatchObject({ agentId: "aaa", known: false, unknownKind: "missing", turn: 0 });
    expect(s.turns[0]!.total.output).toBeNull();
    expect(s.turns[0]!.own.output).toBe(5);
  });

  it("stands an unknown run on a non-failed call that has no run at all, and none on a failed launch", () => {
    const open = oneTurnWithCall("c1");
    expect(oracleSession(input(open.lines)).runs).toMatchObject([{ known: false, unknownKind: "missing", turn: 0 }]);
    const failed = oneTurnWithCall("c1", undefined, true);
    const s = oracleSession(input(failed.lines));
    expect(s.runs).toEqual([]);
    expect(s.unknownKinds).toEqual([]);
  });

  it("does not count a call whose run another session of the project holds", () => {
    const c = oneTurnWithCall("c1");
    const s = oracleSession(input(c.lines, [], { heldElsewhere: new Set(["c1"]) }));
    expect(s.runs).toEqual([]);
    expect(s.unknownKinds).toEqual([]);
    expect(s.countedElsewhere).toBe(1);
  });

  it("marks unreadable and non-regular transcripts and 0 parsable lines unknown", () => {
    const c = oneTurnWithCall("c1");
    const kinds = (transcript: OracleRunInput["transcript"]) => oracleSession(input(c.lines, [{ agentId: "aaa", meta: { toolUseId: "c1" }, transcript }])).runs[0]!.unknownKind;
    expect(kinds({ status: "unreadable" })).toBe("unreadable");
    expect(kinds({ status: "not-regular-file" })).toBe("not-regular");
    expect(kinds({ status: "read", lines: [] })).toBe("unreadable");
  });

  it("makes the session unknown for an unusable folder or too many files, with every call's run unknown", () => {
    const c = oneTurnWithCall("c1");
    for (const status of ["not-regular-folder", "unreadable", "too-many"] as const) {
      const s = oracleSession(input(c.lines, [], { folder: { status } }));
      expect(s.unknownKinds).toEqual([status === "unreadable" ? "folder-unreadable" : status]);
      expect(s.runs).toMatchObject([{ known: false, turn: 0 }]);
      expect(s.turns[0]!.total.output).toBeNull();
    }
    expect(MAX_RUN_FILES).toBe(500);
  });

  it("matches an unlinked run to the one turn whose window holds its first line, else the session is unknown", () => {
    const first = turn(null, 0, [{ id: "m1" }]);
    const second = turn(first.last, 10, [{ id: "m2" }]);
    const lines = [...first.lines, ...second.lines];
    const matched = oracleSession(input(lines, [run("aaa", { lines: transcript("aaa", 11, [{ id: "r1" }]) })]));
    expect(matched.runs[0]).toMatchObject({ turn: 1, link: "timestamp", known: true });
    const before = oracleSession(input(lines, [run("aaa", { lines: transcript("aaa", -5, [{ id: "r1" }]) })]));
    expect(before.runs).toEqual([]);
    expect(before.unknownKinds).toEqual(["unmatched"]);
  });
});

describe("totals per turn", () => {
  it("adds the main agent's own figures and every run's, and is unknown when any part is", () => {
    const c = oneTurnWithCall("c1");
    const a = run("aaa", { toolUseId: "c1", lines: transcript("aaa", 1, [{ id: "r1", usage: usage({ input: 2, write: 0, read: 0, output: 1, oneHour: 0 }) }]) });
    const b = run("bbb", { toolUseId: "c1", lines: transcript("bbb", 1, [{ id: "r2", usage: usage({ input: 3, write: 0, read: 0, output: 1, oneHour: 0 }) }]) });
    const s = oracleSession(input(c.lines, [a, b]));
    expect(s.turns[0]!.total).toEqual({ uncachedInput: 1 + 2 + 3, cacheWrite: 10, cacheRead: 100, output: 5 + 1 + 1 });
  });
});

describe("tool calls", () => {
  it("counts the branch's calls and each read run's, a call id once (a fork repeats its parent's)", () => {
    const t = turn(null, 0, [{ id: "m1", blocks: [agentCall("c1"), toolUse("t1")] }]);
    const r = result(t.last, 1, "c1", { agentId: "aaa" });
    const lines = [...t.lines, r];
    const a = run("aaa", { toolUseId: "c1", lines: transcript("aaa", 1, [{ id: "r1", blocks: [toolUse("t1"), toolUse("t2"), toolUse("t3")] }]) });
    const s = oracleSession(input(lines, [a]));
    const counts = toolCallCounts(s);
    expect(counts.main).toBe(2);
    expect(counts.byRun.get("aaa")).toBe(2); // t1 is the main agent's
    expect(counts.subagents).toBe(2);
    expect(counts.unreadRuns).toEqual([]);
  });

  it("gives the outer run an id before the inner one and leaves an unreadable run out, listed", () => {
    const c = oneTurnWithCall("c1");
    const outer = run("aaa", { toolUseId: "c1", lines: transcript("aaa", 1, [{ id: "r1", blocks: [toolUse("t9")] }]) });
    const inner = run("bbb", { toolUseId: "z", parentAgentId: "aaa", lines: transcript("bbb", 2, [{ id: "r2", blocks: [toolUse("t9"), toolUse("t10")] }]) });
    const gone: OracleRunInput = { agentId: "ccc", meta: { toolUseId: "c1" }, transcript: { status: "missing" } };
    const counts = toolCallCounts(oracleSession(input(c.lines, [inner, outer, gone])));
    expect(counts.byRun.get("aaa")).toBe(1);
    expect(counts.byRun.get("bbb")).toBe(1);
    expect(counts.byRun.has("ccc")).toBe(false);
    expect(counts.unreadRuns).toEqual(["ccc"]);
  });

  it("still reads a run whose usage figure is missing", () => {
    const c = oneTurnWithCall("c1");
    const a = run("aaa", { toolUseId: "c1", lines: transcript("aaa", 1, [{ id: "r1", usage: {}, blocks: [toolUse("t1")] }]) });
    const counts = toolCallCounts(oracleSession(input(c.lines, [a])));
    expect(counts.byRun.get("aaa")).toBe(1);
  });
});

describe("priced cost", () => {
  const rates = { inputUsdPerM: 1, cachedInputUsdPerM: 0.1, cacheWriteUsdPerM: 1.25, extendedCacheWriteUsdPerM: 2, outputUsdPerM: 5 };
  const tables = (version: { tiers: unknown[] } | undefined): ModelTables => ({
    priceVersion: (model) => (model === "claude-a" && version ? ({ id: "v1", modelId: model, effectiveFrom: "2026-01-01", tiers: version.tiers } as never) : undefined),
    cacheRules: () => undefined,
  });

  it("prices the main agent's line and each run on its own model, at the turn's start, with the 1-hour part at its rate", () => {
    const c = oneTurnWithCall("c1");
    const a = run("aaa", { toolUseId: "c1", lines: transcript("aaa", 1, [{ id: "r1", usage: usage({ input: 1_000_000, write: 1_000_000, read: 1_000_000, output: 1_000_000, oneHour: 400_000 }) }]) });
    const s = oracleSession(input(c.lines, [a]));
    const priced = pricedLines(s, tables({ tiers: [rates] }));
    expect(priced.known).toBe(true);
    // run: 1 + 0.1 + (0.6 * 1.25 + 0.4 * 2) + 5 = 7.65; own: tiny.
    const own = (1 * 1 + 100 * 0.1 + 6 * 1.25 + 4 * 2 + 5 * 5) / 1_000_000;
    expect(priced.usd).toBeCloseTo(7.65 + own, 9);
    expect(priced.lines).toBe(2);
  });

  it("prices unsplit cache writes at the 1-hour rate, as Claude Code writes them", () => {
    const c = oneTurnWithCall("c1");
    const a = run("aaa", { toolUseId: "c1", lines: transcript("aaa", 1, [{ id: "r1", usage: usage({ input: 0, write: 1_000_000, read: 0, output: 0, oneHour: null }) }]) });
    const priced = pricedLines(oracleSession(input(c.lines, [a])), tables({ tiers: [rates] }));
    const own = (1 * 1 + 100 * 0.1 + 6 * 1.25 + 4 * 2 + 5 * 5) / 1_000_000;
    expect(priced.known && priced.usd).toBeCloseTo(2 + own, 9);
  });

  it("is unknown when a model has no price, a version has tiers, or any figure is unknown", () => {
    const c = oneTurnWithCall("c1");
    const a = run("aaa", { toolUseId: "c1", lines: transcript("aaa", 1, [{ id: "r1" }]) });
    const s = oracleSession(input(c.lines, [a]));
    expect(pricedLines(s, tables(undefined))).toMatchObject({ known: false });
    const unknownRun = oracleSession(input(c.lines, [{ agentId: "aaa", meta: { toolUseId: "c1" }, transcript: { status: "missing" } }]));
    expect(pricedLines(unknownRun, tables({ tiers: [rates] }))).toMatchObject({ known: false });
  });

  it("can't price a turn with no request: the log records no model for it", () => {
    const only = user(null, 0);
    expect(pricedLines(oracleSession(input([only])), tables({ tiers: [rates] }))).toMatchObject({ known: false });
  });

  it("picks the prompt-length tier of a single request and can't for several", () => {
    const small = { ...rates, maxInputTokens: 200_000 };
    const large = { ...rates, maxInputTokens: undefined, inputUsdPerM: 10 };
    const one = turn(null, 0, [{ id: "m1", usage: usage({ input: 1_000_000, write: 0, read: 0, output: 0, oneHour: 0 }) }]);
    const priced = pricedLines(oracleSession(input(one.lines)), tables({ tiers: [small, large] }));
    expect(priced.known && priced.usd).toBeCloseTo(10, 9);
    // Several requests: the sum can't say which tier each used, unless the sum is in the first tier.
    const twoSmall = turn(null, 0, [{ id: "m1" }, { id: "m2" }]);
    expect(pricedLines(oracleSession(input(twoSmall.lines)), tables({ tiers: [small, large] }))).toMatchObject({ known: true });
    const big = usage({ input: 150_000, write: 0, read: 100_000, output: 0, oneHour: 0 });
    const twoBig = turn(null, 0, [{ id: "m1", usage: big }, { id: "m2", usage: big }]);
    expect(pricedLines(oracleSession(input(twoBig.lines)), tables({ tiers: [small, large] }))).toMatchObject({ known: false });
  });
});

describe("priced cost per turn", () => {
  const rates = { inputUsdPerM: 1, cachedInputUsdPerM: 0.1, cacheWriteUsdPerM: 1.25, extendedCacheWriteUsdPerM: 2, outputUsdPerM: 5 };
  const tables: ModelTables = {
    priceVersion: (model) => (model === "claude-a" ? ({ id: "v1", modelId: model, effectiveFrom: "2026-01-01", tiers: [rates] } as never) : undefined),
    cacheRules: () => undefined,
  };
  const ownUsd = (1 * 1 + 100 * 0.1 + 6 * 1.25 + 4 * 2 + 5 * 5) / 1_000_000;

  it("gives each turn's cost and its runs' part apart, null for a turn with an unpriceable line", () => {
    const first = oneTurnWithCall("c1");
    const second = turn(first.last, 5, [{ id: "m2", model: "claude-zz" }]);
    const a = run("aaa", { toolUseId: "c1", lines: transcript("aaa", 1, [{ id: "r1", usage: usage({ input: 1_000_000, write: 0, read: 0, output: 0, oneHour: 0 }) }]) });
    const turns = pricedTurns(oracleSession(input([...first.lines, ...second.lines], [a])), tables);
    expect(turns).toHaveLength(2);
    expect(turns[0]!.usd).toBeCloseTo(1 + ownUsd, 9);
    expect(turns[0]!.runUsd).toBeCloseTo(1, 9);
    expect(turns[1]).toEqual({ usd: null, runUsd: 0 });
  });
});
