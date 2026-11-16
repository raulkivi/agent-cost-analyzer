// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { subagentLabelSchema, subagentRunIdSchema, type SubagentRunUsage } from "@agent-cost-analyzer/domain";
import type { ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";
import {
  attributeClaudeCodeRuns,
  MAX_CLAUDE_CODE_RUN_DEPTH,
  SUBAGENT_COUNTED_ELSEWHERE_NOTE,
  SUBAGENT_FOLDER_NOT_REGULAR_REASON,
  SUBAGENT_FOLDER_UNREADABLE_REASON,
  SUBAGENT_NESTING_TOO_DEEP_REASON,
  SUBAGENT_TOO_MANY_REASON,
  SUBAGENT_TRANSCRIPT_MISSING_REASON,
  SUBAGENT_TRANSCRIPT_NOT_REGULAR_REASON,
  SUBAGENT_TRANSCRIPT_UNREADABLE_REASON,
  SUBAGENT_UNMATCHED_REASON,
  type ClaudeCodeRunInput,
  type ClaudeCodeRunTranscript,
  type ClaudeCodeSubagentAttribution,
  type ClaudeCodeSubagentFolder,
} from "./subagent-attribution.js";
import {
  branchOf,
  loadClaudeCodeSession,
  sessionFileOfCase,
  type LoadedClaudeCodeSession,
} from "./subagent-case-loader.js";
import {
  copySubagentFixtureCase,
  makeSubagentCapFolder,
  makeSymlinkedSubagentTranscript,
} from "./subagent-fixture-builders.js";
import { MAX_CLAUDE_CODE_SUBAGENT_FILES_PER_SESSION } from "./subagent-transcript-path.js";

const FIXTURES = fileURLToPath(new URL("../../../fixtures/claude-code/subagents/", import.meta.url));
const known = (value: number) => ({ known: true, value });
const CASES = [
  "linked-run",
  "nested-run",
  "fork-copy",
  "nested-fork-copy",
  "failed-launch",
  "missing-transcript",
  "unlinked-transcript",
  "partial-last-line",
  "off-branch-call",
  "synthetic-round",
  "one-hour-cache",
  "continued-run",
];

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "cs8-"));
  tempDirs.push(dir);
  return dir;
};

async function loadCase(name: string): Promise<LoadedClaudeCodeSession> {
  return loadClaudeCodeSession(sessionFileOfCase(join(FIXTURES, name)));
}

function attribute(
  loaded: Pick<LoadedClaudeCodeSession, "sessionEntries" | "branch" | "turnGroups" | "folder" | "runs">,
  countedInOtherSessions?: ReadonlySet<string>,
): ClaudeCodeSubagentAttribution {
  return attributeClaudeCodeRuns({ ...loaded, countedInOtherSessions });
}

const runsOf = (result: ClaudeCodeSubagentAttribution, turn: number): SubagentRunUsage[] =>
  result.byTurn.get(turn)?.runs ?? [];
const allRuns = (result: ClaudeCodeSubagentAttribution): SubagentRunUsage[] =>
  [...result.byTurn.values()].flatMap((entry) => entry.runs);
const tokenFields = ["uncachedInput", "cacheWrite", "cacheRead", "output"] as const;
const isKnownRun = (run: SubagentRunUsage): boolean => tokenFields.every((field) => run[field].known);

// ---- inline sessions -----------------------------------------------------

const usageOf = (input: number, extra: Record<string, unknown> = {}) => ({
  input_tokens: input,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  output_tokens: 1,
  cache_creation: { ephemeral_1h_input_tokens: 0 },
  ...extra,
});

const at = (seconds: number): string => new Date(Date.UTC(2026, 9, 20, 10, 0, seconds)).toISOString();

function prompt(uuid: string, parent: string | null, seconds: number): ClaudeCodeRawEntry {
  return {
    type: "user",
    uuid,
    parentUuid: parent,
    timestamp: at(seconds),
    message: { role: "user", content: "Made-up prompt." },
  };
}

function round(
  messageId: string,
  uuid: string,
  parent: string,
  seconds: number,
  options: { blocks?: unknown[]; usage?: Record<string, unknown>; agentId?: string; model?: string } = {},
): ClaudeCodeRawEntry {
  return {
    type: "assistant",
    uuid,
    parentUuid: parent,
    timestamp: at(seconds),
    requestId: `req_${messageId}`,
    ...(options.agentId === undefined ? {} : { agentId: options.agentId }),
    message: {
      id: messageId,
      model: options.model ?? "claude-sonnet-5-5",
      content: options.blocks ?? [{ type: "text", text: "Made-up answer." }],
      usage: options.usage ?? usageOf(10),
    },
  };
}

const callBlock = (id: string, name = "Agent") => [{ type: "tool_use", id, name, input: {} }];

function result(
  uuid: string,
  parent: string,
  seconds: number,
  callId: string,
  extra: { agentId?: string; isError?: boolean } = {},
): ClaudeCodeRawEntry {
  return {
    type: "user",
    uuid,
    parentUuid: parent,
    timestamp: at(seconds),
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: callId, content: "Done.", ...(extra.isError ? { is_error: true } : {}) }],
    },
    ...(extra.agentId === undefined ? {} : { toolUseResult: { agentId: extra.agentId } }),
  };
}

/** A chain of lines (each parented on the previous one) read as one session file. */
function session(...lines: ClaudeCodeRawEntry[]): Pick<LoadedClaudeCodeSession, "sessionEntries" | "branch" | "turnGroups"> {
  return { sessionEntries: lines, ...branchOf(lines) };
}

function transcriptOf(agentId: string, ...lines: ClaudeCodeRawEntry[]): ClaudeCodeRunTranscript {
  return { status: "read", entries: lines.map((line) => ({ ...line, agentId })) };
}

const OK_FOLDER: ClaudeCodeSubagentFolder = { status: "ok" };
const oneRound = (agentId: string, messageId: string, seconds: number, input = 10): ClaudeCodeRunTranscript =>
  transcriptOf(agentId, round(messageId, `${agentId}-${messageId}`, "none", seconds, { usage: usageOf(input) }));

/** One prompt, one `Agent` call, its result: turn 0 started `callId`. */
const oneCallSession = (callId: string, agentId?: string, toolName = "Agent") =>
  session(
    prompt("u1", null, 0),
    round("m1", "a1", "u1", 1, { blocks: callBlock(callId, toolName) }),
    result("r1", "a1", 2, callId, { agentId }),
    round("m2", "a2", "r1", 3),
  );

// ---- section 6: honesty rules -------------------------------------------

describe("attributeClaudeCodeRuns, section 6 rows", () => {
  it("linked transcript, every round numeric: run known, placed on the starting turn by tool-use-id", async () => {
    const loaded = await loadCase("linked-run");

    const result = attribute(loaded);

    const [run] = runsOf(result, 0);
    expect(allRuns(result)).toHaveLength(1);
    expect(run).toMatchObject({
      id: "a111111111111111a",
      label: "Agent-general-purpose",
      attribution: "tool-use-id",
      roundsCount: 2,
    });
    expect(isKnownRun(run)).toBe(true);
    expect(result.sessionUnknownReasons).toEqual([]);
    expect(subagentRunIdSchema.safeParse(run.id).success).toBe(true);
    expect(subagentLabelSchema.safeParse(run.label).success).toBe(true);
  });

  it("links by the parent result's agentId when the meta has no toolUseId", async () => {
    const loaded = await loadCase("linked-run");
    const [run] = loaded.runs;

    const result = attribute({ ...loaded, runs: [{ ...run, meta: { ...run.meta, toolUseId: undefined } }] });

    expect(runsOf(result, 0)).toHaveLength(1);
    expect(runsOf(result, 0)[0].attribution).toBe("tool-use-id");
  });

  it("links a run with no meta file by the parent result's agentId", async () => {
    const loaded = await loadCase("linked-run");

    const result = attribute({ ...loaded, runs: [{ ...loaded.runs[0], meta: undefined }] });

    expect(runsOf(result, 0)[0]).toMatchObject({ label: "Agent", attribution: "tool-use-id" });
  });

  it("meta present, transcript missing: an unknown run on the turn and an unknown session", async () => {
    const result = attribute(await loadCase("missing-transcript"));

    const [run] = runsOf(result, 0);
    expect(run.id).toBe("a611111111111111a");
    expect(run.output).toEqual({ known: false, reason: SUBAGENT_TRANSCRIPT_MISSING_REASON });
    expect(isKnownRun(run)).toBe(false);
    expect(SUBAGENT_TRANSCRIPT_MISSING_REASON).toBe("The subagent transcript this turn started is missing.");
    expect(result.sessionUnknownReasons).toEqual([SUBAGENT_TRANSCRIPT_MISSING_REASON]);
  });

  it("a non-failed Agent call with no run in the folder is missing, as an unknown placeholder run", async () => {
    const loaded = await loadCase("linked-run");

    const result = attribute({ ...loaded, runs: [] });

    const [run] = runsOf(result, 0);
    expect(run.id).toBe("toolu_lr_call");
    expect(run.attribution).toBe("tool-use-id");
    expect(run.uncachedInput).toEqual({ known: false, reason: SUBAGENT_TRANSCRIPT_MISSING_REASON });
    expect(result.sessionUnknownReasons).toEqual([SUBAGENT_TRANSCRIPT_MISSING_REASON]);
  });

  it("an Agent call with is_error and no transcript is no run, and every figure stays known (D8)", async () => {
    const result = attribute(await loadCase("failed-launch"));

    expect(result.byTurn.size).toBe(0);
    expect(result.sessionUnknownReasons).toEqual([]);
  });

  it("a failed call that did leave a transcript still counts that run", async () => {
    const loaded = session(
      prompt("u1", null, 0),
      round("m1", "a1", "u1", 1, { blocks: callBlock("toolu_x") }),
      result("r1", "a1", 2, "toolu_x", { isError: true, agentId: "ax1" }),
    );

    const out = attribute({ ...loaded, folder: OK_FOLDER, runs: [{ agentId: "ax1", transcript: oneRound("ax1", "mx", 1) }] });

    expect(runsOf(out, 0)).toHaveLength(1);
  });

  it("a symlinked transcript is unknown with the not-a-regular-file reason", async () => {
    const root = tempDir();
    const copy = copySubagentFixtureCase("linked-run", root);
    makeSymlinkedSubagentTranscript(copy, root);

    const result = attribute(await loadClaudeCodeSession(copy.sessionFile));

    expect(runsOf(result, 0)[0].output).toEqual({ known: false, reason: SUBAGENT_TRANSCRIPT_NOT_REGULAR_REASON });
    expect(SUBAGENT_TRANSCRIPT_NOT_REGULAR_REASON).toContain("not a regular file");
    expect(result.sessionUnknownReasons).toEqual([SUBAGENT_TRANSCRIPT_NOT_REGULAR_REASON]);
  });

  it("a folder that is not a regular folder leaves each non-failed call missing and the session unknown", async () => {
    const loaded = await loadCase("linked-run");

    const result = attribute({ ...loaded, folder: { status: "unusable", reason: "not-regular-folder" }, runs: [] });

    expect(runsOf(result, 0)).toHaveLength(1);
    expect(runsOf(result, 0)[0].output).toEqual({ known: false, reason: SUBAGENT_FOLDER_NOT_REGULAR_REASON });
    expect(SUBAGENT_FOLDER_NOT_REGULAR_REASON).toContain("not a regular folder");
    expect(result.sessionUnknownReasons).toEqual([SUBAGENT_FOLDER_NOT_REGULAR_REASON]);
  });

  it("a symlinked subagents folder read from disk is the same unknown session", async () => {
    const root = tempDir();
    const copy = copySubagentFixtureCase("linked-run", root);
    const { symlinkSync, renameSync } = await import("node:fs");
    renameSync(copy.subagentsDir, join(root, "elsewhere"));
    symlinkSync(join(root, "elsewhere"), copy.subagentsDir);

    const result = attribute(await loadClaudeCodeSession(copy.sessionFile));

    expect(result.sessionUnknownReasons).toEqual([SUBAGENT_FOLDER_NOT_REGULAR_REASON]);
  });

  it("an unlistable folder leaves the session unknown, not empty", async () => {
    const loaded = await loadCase("failed-launch");

    const result = attribute({ ...loaded, folder: { status: "unusable", reason: "unreadable" } });

    expect(result.sessionUnknownReasons).toEqual([SUBAGENT_FOLDER_UNREADABLE_REASON]);
  });

  it("more files than the cap: nothing is read and the session is unknown", async () => {
    const root = tempDir();
    const copy = makeSubagentCapFolder(root, MAX_CLAUDE_CODE_SUBAGENT_FILES_PER_SESSION + 1);

    const loaded = await loadClaudeCodeSession(copy.sessionFile);
    const result = attribute(loaded);

    expect(loaded.runs).toEqual([]);
    expect(result.sessionUnknownReasons).toEqual([SUBAGENT_TOO_MANY_REASON]);
    expect(SUBAGENT_TOO_MANY_REASON).toContain("too many subagent transcripts to read");
  });

  it("names outside the pattern are ignored: the forked-skill files change no figure", async () => {
    const loaded = await loadCase("linked-run");

    expect(loaded.runs.map((run) => run.agentId)).toEqual(["a111111111111111a"]);
    const result = attribute(loaded);
    expect(allRuns(result)).toHaveLength(1);
    expect(result.sessionUnknownReasons).toEqual([]);
  });

  it("an unreadable transcript is an unknown run", async () => {
    const loaded = await loadCase("linked-run");

    const result = attribute({ ...loaded, runs: [{ ...loaded.runs[0], transcript: { status: "unreadable" } }] });

    expect(runsOf(result, 0)[0].output).toEqual({ known: false, reason: SUBAGENT_TRANSCRIPT_UNREADABLE_REASON });
    expect(result.sessionUnknownReasons).toEqual([SUBAGENT_TRANSCRIPT_UNREADABLE_REASON]);
  });

  it("a transcript with 0 parsable lines is an unknown run, not an empty known one", async () => {
    const loaded = await loadCase("linked-run");

    const result = attribute({ ...loaded, runs: [{ ...loaded.runs[0], transcript: { status: "read", entries: [] } }] });

    expect(runsOf(result, 0)[0].output.known).toBe(false);
    expect(result.sessionUnknownReasons).toEqual([SUBAGENT_TRANSCRIPT_UNREADABLE_REASON]);
  });

  it("a round missing a numeric usage field makes that field unknown for the run and the session", () => {
    const loaded = oneCallSession("toolu_f", "af1");
    const transcript = transcriptOf(
      "af1",
      round("mf1", "f1", "none", 1, { usage: { ...usageOf(10), output_tokens: undefined } }),
    );

    const out = attribute({ ...loaded, folder: OK_FOLDER, runs: [{ agentId: "af1", transcript }] });

    const [run] = runsOf(out, 0);
    expect(run.output.known).toBe(false);
    expect(run.uncachedInput).toEqual(known(10));
    expect(out.sessionUnknownReasons).toHaveLength(1);
    expect(out.sessionUnknownReasons[0]).toContain("numeric usage figure");
  });

  it("a partial last line of a live run is skipped: figures are as of now and known", async () => {
    const result = attribute(await loadCase("partial-last-line"));

    expect(allRuns(result)).toHaveLength(1);
    expect(allRuns(result)[0].roundsCount).toBe(1);
    expect(isKnownRun(allRuns(result)[0])).toBe(true);
    expect(result.sessionUnknownReasons).toEqual([]);
  });

  it("a fork's copied round is skipped: counted once, in the parent", async () => {
    const loaded = await loadCase("fork-copy");

    const result = attribute(loaded);

    const [run] = runsOf(result, 0);
    expect(run.roundsCount).toBe(2);
    expect(run.uncachedInput.known).toBe(true);
  });

  it("a nested run deeper than the cap is an unknown run on the turn that started its chain", () => {
    const chain = Array.from({ length: MAX_CLAUDE_CODE_RUN_DEPTH + 1 }, (_, index) => `an${index}`);
    const loaded = oneCallSession("toolu_deep", "an0");
    const runs: ClaudeCodeRunInput[] = chain.map((agentId, index) => ({
      agentId,
      meta: index === 0 ? { toolUseId: "toolu_deep" } : { parentAgentId: chain[index - 1] },
      transcript: oneRound(agentId, `m_${agentId}`, 10 + index),
    }));

    const out = attribute({ ...loaded, folder: OK_FOLDER, runs });

    const placed = runsOf(out, 0);
    expect(placed).toHaveLength(MAX_CLAUDE_CODE_RUN_DEPTH + 1);
    expect(placed.filter(isKnownRun)).toHaveLength(MAX_CLAUDE_CODE_RUN_DEPTH);
    const deepest = placed.find((run) => run.id === chain[MAX_CLAUDE_CODE_RUN_DEPTH]);
    expect(deepest?.output).toEqual({ known: false, reason: SUBAGENT_NESTING_TOO_DEEP_REASON });
    expect(out.sessionUnknownReasons).toEqual([SUBAGENT_NESTING_TOO_DEEP_REASON]);
    expect(SUBAGENT_NESTING_TOO_DEEP_REASON).toBe("nested subagents beyond the read depth");
  });

  it("a parentAgentId cycle is unknown for the session and counts none of its runs", () => {
    const loaded = oneCallSession("toolu_c");
    const runs: ClaudeCodeRunInput[] = [
      { agentId: "ac1", meta: { parentAgentId: "ac2" }, transcript: oneRound("ac1", "mc1", 10) },
      { agentId: "ac2", meta: { parentAgentId: "ac1" }, transcript: oneRound("ac2", "mc2", 11) },
    ];

    const out = attribute({ ...loaded, folder: OK_FOLDER, runs });

    expect(allRuns(out).filter(isKnownRun)).toEqual([]);
    expect(out.sessionUnknownReasons).toContain(SUBAGENT_NESTING_TOO_DEEP_REASON);
  });

  it("an unlinked transcript is matched by the time of its first line and labeled so (D6)", async () => {
    const result = attribute(await loadCase("unlinked-transcript"));

    expect(runsOf(result, 0)).toHaveLength(1);
    expect(runsOf(result, 0)[0].attribution).toBe("timestamp");
    expect(result.sessionUnknownReasons).toEqual([]);
  });

  it("an unlinked transcript outside every turn window leaves the session unknown (D6)", async () => {
    const loaded = await loadCase("unlinked-transcript");
    const [run] = loaded.runs;
    const early = transcriptOf("a711111111111111a", {
      ...round("m_early", "e1", "none", 0),
      timestamp: "2026-10-07T09:00:00.000Z",
    });

    const result = attribute({ ...loaded, runs: [{ ...run, transcript: early }] });

    expect(result.byTurn.size).toBe(0);
    expect(result.sessionUnknownReasons).toEqual([SUBAGENT_UNMATCHED_REASON]);
    expect(SUBAGENT_UNMATCHED_REASON).toBe(
      "A subagent transcript in this session's folder could not be matched to a turn.",
    );
  });

  it("an unlinked transcript with no usable timestamp leaves the session unknown (D6)", async () => {
    const loaded = await loadCase("unlinked-transcript");
    const [run] = loaded.runs;
    const entries = run.transcript.status === "read" ? run.transcript.entries : [];
    const stripped = entries.map((entry) => ({ ...entry, timestamp: undefined }));

    const result = attribute({ ...loaded, runs: [{ ...run, transcript: { status: "read", entries: stripped } }] });

    expect(result.byTurn.size).toBe(0);
    expect(result.sessionUnknownReasons).toEqual([SUBAGENT_UNMATCHED_REASON]);
  });

  it("an unlinked run whose start falls in two overlapping windows is not guessed (D6)", () => {
    // Prompts written out of order (clock skew): windows [10, 100) and [50, end) overlap at 60.
    const skewed = session(
      prompt("u1", null, 10),
      round("m1", "a1", "u1", 11),
      prompt("u2", "a1", 100),
      round("m2", "a2", "u2", 101),
      prompt("u3", "a2", 50),
      round("m3", "a3", "u3", 51),
    );
    const ordered = session(prompt("u1", null, 0), round("m1", "a1", "u1", 1), prompt("u2", "a1", 100), round("m2", "a2", "u2", 101));

    const unmatched = attribute({ ...skewed, folder: OK_FOLDER, runs: [{ agentId: "au1", transcript: oneRound("au1", "mu", 60) }] });
    const matched = attribute({ ...ordered, folder: OK_FOLDER, runs: [{ agentId: "au1", transcript: oneRound("au1", "mu", 102) }] });

    expect(unmatched.byTurn.size).toBe(0);
    expect(unmatched.sessionUnknownReasons).toEqual([SUBAGENT_UNMATCHED_REASON]);
    expect(runsOf(matched, 1)).toHaveLength(1);
  });

  it("a session file's own unreadability is outside this module: with no entries there is nothing to attribute", () => {
    const out = attribute({ ...session(), folder: OK_FOLDER, runs: [] });

    expect(out.byTurn.size).toBe(0);
    expect(out.sessionUnknownReasons).toEqual([]);
  });
});

// ---- decisions D1-D8 ------------------------------------------------------

describe("attributeClaudeCodeRuns, decisions", () => {
  it("D1: the whole run belongs to the turn that started it, even for rounds after a later prompt", () => {
    const loaded = session(
      prompt("u1", null, 0),
      round("m1", "a1", "u1", 1, { blocks: callBlock("toolu_d1") }),
      result("r1", "a1", 2, "toolu_d1", { agentId: "ad1" }),
      round("m2", "a2", "r1", 3),
      prompt("u2", "a2", 100),
      round("m3", "a3", "u2", 101),
    );
    const transcript = transcriptOf(
      "ad1",
      round("md1", "d1", "none", 4),
      round("md2", "d2", "d1", 150),
      round("md3", "d3", "d2", 400),
    );

    const out = attribute({ ...loaded, folder: OK_FOLDER, runs: [{ agentId: "ad1", transcript }] });

    expect(runsOf(out, 0)).toHaveLength(1);
    expect(runsOf(out, 0)[0].roundsCount).toBe(3);
    expect(runsOf(out, 1)).toEqual([]);
  });

  it("D2: a continued run stays on the starting turn, with its continuation rounds already summed", async () => {
    const result = attribute(await loadCase("continued-run"));

    expect(result.byTurn.size).toBe(1);
    expect(runsOf(result, 0)[0].roundsCount).toBe(3);
    expect(isKnownRun(runsOf(result, 0)[0])).toBe(true);
  });

  it("D2: a continuation from a later turn does not move the run", () => {
    const loaded = session(
      prompt("u1", null, 0),
      round("m1", "a1", "u1", 1, { blocks: callBlock("toolu_d2") }),
      result("r1", "a1", 2, "toolu_d2", { agentId: "ae1" }),
      prompt("u2", "r1", 100),
      round("m2", "a2", "u2", 101, { blocks: callBlock("toolu_send", "SendMessage") }),
      result("r2", "a2", 102, "toolu_send"),
    );

    const out = attribute({ ...loaded, folder: OK_FOLDER, runs: [{ agentId: "ae1", transcript: oneRound("ae1", "me1", 105) }] });

    expect(runsOf(out, 0)).toHaveLength(1);
    expect(out.byTurn.has(1)).toBe(false);
  });

  it("D3: a nested run is listed as its own run with parentRunId, on the top run's turn and its own model", async () => {
    const result = attribute(await loadCase("nested-run"));

    const runs = runsOf(result, 0);
    expect(runs.map((run) => run.id)).toEqual(["a211111111111111a", "a222222222222222b"]);
    const nested = runs[1];
    expect(nested).toMatchObject({ parentRunId: "a211111111111111a", model: "claude-haiku-5-5", attribution: "tool-use-id" });
    expect(runs[0].parentRunId).toBeUndefined();
    expect(result.sessionUnknownReasons).toEqual([]);
  });

  it("D3: a nested run whose parent run is off the active branch is off-branch too", () => {
    const loaded = oneCallSession("toolu_other", "ag9");
    const runs: ClaudeCodeRunInput[] = [
      { agentId: "ag1", meta: { toolUseId: "toolu_unknown_call" }, transcript: oneRound("ag1", "mg1", 10) },
      { agentId: "ag2", meta: { parentAgentId: "ag1" }, transcript: oneRound("ag2", "mg2", 11) },
    ];
    const withOffBranch = {
      ...loaded,
      sessionEntries: [...loaded.sessionEntries, round("mo", "o1", "u1", 5, { blocks: callBlock("toolu_unknown_call") })],
    };

    const out = attribute({ ...withOffBranch, folder: OK_FOLDER, runs });

    expect(out.offBranchRunIds).toEqual(["ag1", "ag2"]);
    expect(allRuns(out).map((run) => run.id)).not.toContain("ag2");
  });

  it("D4: a depth-1 fork's copy of a session round is not counted again", async () => {
    const loaded = await loadCase("fork-copy");
    const sessionRounds = loaded.branch.filter((entry) => entry.type === "assistant").length;

    const result = attribute(loaded);

    expect(sessionRounds).toBeGreaterThan(0);
    expect(runsOf(result, 0)[0].roundsCount).toBe(2);
  });

  it("D4: a nested fork skips the rounds it copied from its parent run (the skip set is the whole parent chain)", async () => {
    const loaded = await loadCase("nested-fork-copy");

    const result = attribute(loaded);

    const [parentRun, fork] = runsOf(result, 0);
    expect(parentRun.id).toBe("a411111111111111a");
    expect(parentRun.roundsCount).toBe(3);
    expect(fork.id).toBe("a422222222222222b");
    expect(fork.parentRunId).toBe("a411111111111111a");
    expect(fork.roundsCount).toBe(1);
    expect(fork.uncachedInput).toEqual(known(360));
    expect(result.sessionUnknownReasons).toEqual([]);
  });

  it("D4: a grandchild skips main-session rounds, its parent's copies and its grandparent's own rounds", () => {
    const loaded = oneCallSession("toolu_gc", "g1");
    const mainIds = loaded.branch.filter((entry) => entry.type === "assistant").map((entry) => entry.message as { id: string });
    const mainRound = (loaded.branch.find((entry) => entry.type === "assistant")?.message as { id: string }).id;
    expect(mainIds.length).toBeGreaterThan(0);
    const copy = (messageId: string, seconds: number) => round(messageId, `c_${messageId}_${seconds}`, "none", seconds);
    const runs: ClaudeCodeRunInput[] = [
      {
        agentId: "g1",
        meta: { toolUseId: "toolu_gc" },
        transcript: transcriptOf("g1", copy(mainRound, 10), copy("g1_own", 11)),
      },
      {
        agentId: "g2",
        meta: { parentAgentId: "g1", isFork: true },
        transcript: transcriptOf("g2", copy(mainRound, 20), copy("g1_own", 21), copy("g2_own", 22)),
      },
      {
        agentId: "g3",
        meta: { parentAgentId: "g2", isFork: true },
        transcript: transcriptOf("g3", copy(mainRound, 30), copy("g1_own", 31), copy("g2_own", 32), copy("g3_own", 33)),
      },
    ];

    const out = attribute({ ...loaded, folder: OK_FOLDER, runs });

    const counted = Object.fromEntries(runsOf(out, 0).map((run) => [run.id, run.roundsCount]));
    expect(counted).toEqual({ g1: 1, g2: 1, g3: 1 });
  });

  it("D4: in every fixture case, a known total counts each distinct round once and leaves none out", async () => {
    const roundIds = (entries: readonly ClaudeCodeRawEntry[]): Set<string> =>
      new Set(
        entries.flatMap((entry) => {
          const message = entry.message as { id?: string; model?: string } | undefined;
          const real = entry.type === "assistant" && message?.id !== undefined && message.model !== "<synthetic>";
          return real ? [message.id as string] : [];
        }),
      );

    for (const name of CASES) {
      const loaded = await loadCase(name);
      const result = attribute(loaded);
      const placed = new Set(allRuns(result).map((run) => run.id));
      const everyRound = roundIds(loaded.branch);
      for (const run of loaded.runs) {
        if (run.transcript.status === "read" && placed.has(run.agentId)) {
          for (const id of roundIds(run.transcript.entries)) everyRound.add(id);
        }
      }
      const counted = roundIds(loaded.branch).size + allRuns(result).reduce((sum, run) => sum + run.roundsCount, 0);

      // An unknown session may leave rounds out, and says so; a known one may not.
      if (result.sessionUnknownReasons.length === 0) expect(counted, name).toBe(everyRound.size);
    }
  });

  it("D5: a run whose Agent call is off the active branch is not counted, and is reported for the oracle", async () => {
    const result = attribute(await loadCase("off-branch-call"));

    expect(result.byTurn.size).toBe(0);
    expect(result.offBranchRunIds).toEqual(["a911111111111111a"]);
    expect(result.sessionUnknownReasons).toEqual([]);
  });

  it("D5: an off-branch call is not a missing run: the call has its transcript, so nothing is unknown", async () => {
    const loaded = await loadCase("off-branch-call");

    const result = attribute({ ...loaded, runs: [] });

    expect(result.byTurn.size).toBe(0);
    expect(result.sessionUnknownReasons).toEqual([]);
  });

  it("D6: see the unlinked-transcript tests above: matched by time, labeled, else the session is unknown", async () => {
    const result = attribute(await loadCase("unlinked-transcript"));

    expect(runsOf(result, 0)[0].attribution).toBe("timestamp");
  });

  it("D7: a call whose run another session's folder holds is counted there; this turn says so and stays known", async () => {
    const loaded = await loadCase("linked-run");

    const byCall = attribute({ ...loaded, runs: [] }, new Set(["toolu_lr_call"]));
    const byAgentId = attribute({ ...loaded, runs: [] }, new Set(["a111111111111111a"]));

    for (const result of [byCall, byAgentId]) {
      expect(allRuns(result)).toEqual([]);
      expect(result.byTurn.get(0)?.notes).toEqual([SUBAGENT_COUNTED_ELSEWHERE_NOTE]);
      expect(result.sessionUnknownReasons).toEqual([]);
    }
    expect(SUBAGENT_COUNTED_ELSEWHERE_NOTE).toBe("A subagent run this turn started is counted in another session.");
  });

  it("D7: with no other folder holding it, the same call is missing", async () => {
    const loaded = await loadCase("linked-run");

    const result = attribute({ ...loaded, runs: [] }, new Set(["toolu_someone_else"]));

    expect(result.sessionUnknownReasons).toEqual([SUBAGENT_TRANSCRIPT_MISSING_REASON]);
  });

  it("D8: a failed launch is no run and figures stay known", async () => {
    const result = attribute(await loadCase("failed-launch"));

    expect(result.byTurn.size).toBe(0);
    expect(result.sessionUnknownReasons).toEqual([]);
  });
});

// ---- other rules ----------------------------------------------------------

describe("attributeClaudeCodeRuns, other rules", () => {
  it("fills the run id from the file name when no transcript line carries an agentId", () => {
    const loaded = oneCallSession("toolu_i", "ai1");
    const bare = { status: "read" as const, entries: [round("mi1", "i1", "none", 10)] };

    const out = attribute({ ...loaded, folder: OK_FOLDER, runs: [{ agentId: "ai1", transcript: bare }] });

    expect(runsOf(out, 0)[0].id).toBe("ai1");
  });

  it("accepts a `Task` call as well as an `Agent` call", () => {
    const loaded = oneCallSession("toolu_t", "at1", "Task");

    const out = attribute({ ...loaded, folder: OK_FOLDER, runs: [] });

    expect(runsOf(out, 0)[0].id).toBe("toolu_t");
  });

  it("places each of two runs on its own turn and orders a turn's runs by start time", () => {
    const loaded = session(
      prompt("u1", null, 0),
      round("m1", "a1", "u1", 1, { blocks: callBlock("toolu_p1") }),
      result("r1", "a1", 2, "toolu_p1", { agentId: "ap1" }),
      round("m2", "a2", "r1", 3, { blocks: callBlock("toolu_p3") }),
      result("r2", "a2", 4, "toolu_p3", { agentId: "ap3" }),
      round("m3", "a3", "r2", 5, { blocks: callBlock("toolu_p2") }),
      result("r3", "a3", 6, "toolu_p2", { agentId: "ap2" }),
      prompt("u2", "r3", 100),
      round("m4", "a4", "u2", 101, { blocks: callBlock("toolu_p4") }),
      result("r4", "a4", 102, "toolu_p4", { agentId: "ap4" }),
    );
    const runs: ClaudeCodeRunInput[] = [
      { agentId: "ap1", meta: { toolUseId: "toolu_p1" }, transcript: oneRound("ap1", "mp1", 30) },
      { agentId: "ap2", meta: { toolUseId: "toolu_p2" }, transcript: oneRound("ap2", "mp2", 10) },
      { agentId: "ap3", meta: { toolUseId: "toolu_p3" }, transcript: oneRound("ap3", "mp3", 20) },
      { agentId: "ap4", meta: { toolUseId: "toolu_p4" }, transcript: oneRound("ap4", "mp4", 110) },
    ];

    const out = attribute({ ...loaded, folder: OK_FOLDER, runs });

    expect(runsOf(out, 0).map((run) => run.id)).toEqual(["ap2", "ap3", "ap1"]);
    expect(runsOf(out, 1).map((run) => run.id)).toEqual(["ap4"]);
  });

  it("a run unknown for one reason adds that reason to the session once", () => {
    const loaded = oneCallSession("toolu_r", "ar1");
    const runs: ClaudeCodeRunInput[] = [
      { agentId: "ar1", meta: { toolUseId: "toolu_r" }, transcript: { status: "missing" } },
      { agentId: "ar2", meta: { parentAgentId: "ar1" }, transcript: { status: "missing" } },
    ];

    const out = attribute({ ...loaded, folder: OK_FOLDER, runs });

    expect(out.sessionUnknownReasons).toEqual([SUBAGENT_TRANSCRIPT_MISSING_REASON]);
  });

  it("an unreadable ancestor still leaves a known child's total unknown through the session reason", () => {
    const loaded = oneCallSession("toolu_u", "au1");
    const runs: ClaudeCodeRunInput[] = [
      { agentId: "au1", meta: { toolUseId: "toolu_u" }, transcript: { status: "unreadable" } },
      { agentId: "au2", meta: { parentAgentId: "au1" }, transcript: oneRound("au2", "mu2", 12) },
    ];

    const out = attribute({ ...loaded, folder: OK_FOLDER, runs });

    expect(out.sessionUnknownReasons).toEqual([SUBAGENT_TRANSCRIPT_UNREADABLE_REASON]);
  });

  it("every run's costAiCredits stays unknown without becoming a session reason", async () => {
    const result = attribute(await loadCase("linked-run"));

    expect(runsOf(result, 0)[0].costAiCredits.known).toBe(false);
    expect(result.sessionUnknownReasons).toEqual([]);
  });

  it("a parent chain unchanged when read twice (pure: same input, same output)", async () => {
    const loaded = await loadCase("nested-fork-copy");

    expect(attribute(loaded)).toEqual(attribute(loaded));
  });
});
