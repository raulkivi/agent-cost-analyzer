// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { subagentRunUsageSchema, type SubagentRunUsage } from "@agent-cost-analyzer/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectChildSessionRefs, type ChildSessionRef } from "./child-session-refs.js";
import { readMainJsonlFile, type JsonlEnvelope } from "./main-jsonl-reader.js";
import {
  attributeSubagentRuns,
  logTurnAt,
  logTurnStartTimes,
  SUBAGENT_FOLDER_UNREADABLE_REASON,
  SUBAGENT_LOG_MISSING_REASON,
  SUBAGENT_LOG_NAME_REJECTED_REASON,
  SUBAGENT_LOG_NOT_REGULAR_FILE_REASON,
  SUBAGENT_LOG_READ_FAILED_REASON,
  SUBAGENT_LOGS_TOO_MANY_REASON,
  SUBAGENT_REF_BEFORE_FIRST_TURN_REASON,
  SUBAGENT_RUN_UNPLACEABLE_REASON,
  type SubagentAttribution,
  type SubagentLogSource,
} from "./subagent-attribution.js";
import { SUBAGENT_LOG_NAME } from "./subagent-log-path.js";
import { folderSubagentLogSource } from "./subagent-log-source.js";
import { NESTED_SUBAGENTS_REASON } from "./subagent-run-usage.js";
import { AI_CREDITS_NOT_AVAILABLE_REASON } from "./session-usage-spans.js";

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/jsonl/subagents");
const BASE = 1790000000000;

// ---- fixture cases, through the real file-system adapter -------------------

interface Recorded {
  source: SubagentLogSource;
  reads: string[];
}

// Wraps a source so a test can prove which files were (not) read.
function recording(source: SubagentLogSource): Recorded {
  const reads: string[] = [];
  return {
    reads,
    source: {
      resolve: (name) => source.resolve(name),
      list: () => source.list(),
      read: (filePath) => {
        reads.push(path.basename(filePath));
        return source.read(filePath);
      },
    },
  };
}

async function attributeFolder(sessionDir: string, folderId = path.basename(sessionDir), source?: SubagentLogSource) {
  const { envelopes } = await readMainJsonlFile(path.join(sessionDir, "main.jsonl"));
  const recorded = recording(source ?? folderSubagentLogSource(sessionDir));
  const result = await attributeSubagentRuns({
    folderId,
    refs: collectChildSessionRefs(envelopes),
    logTurnStarts: logTurnStartTimes(envelopes),
    source: recorded.source,
  });
  return { result, reads: recorded.reads };
}

const attributeFixture = (caseName: string) => attributeFolder(path.join(fixturesDir, caseName));

function runsOn(result: SubagentAttribution, logTurn: number): SubagentRunUsage[] {
  return result.byLogTurn.get(logTurn) ?? [];
}

function allRuns(result: SubagentAttribution): SubagentRunUsage[] {
  return [...result.byLogTurn.values()].flat();
}

describe("attributeSubagentRuns over the SA2 fixtures (design §4.3)", () => {
  it("places a referenced run and a referenced search on the log turns whose refs name them", async () => {
    const { result } = await attributeFixture("run-and-search");

    expect([...result.byLogTurn.keys()]).toEqual([0, 1]);
    expect(runsOn(result, 0)).toEqual([
      expect.objectContaining({
        id: "call_fixturerun1",
        label: "runSubagent-Explore",
        agentName: "Explore",
        attribution: "child-session-ref",
        costAiCredits: { known: true, value: expect.closeTo(1.1, 9) },
      }),
    ]);
    expect(runsOn(result, 1)).toEqual([
      expect.objectContaining({ id: "call_fixturesearch1", label: "searchSubagent", costAiCredits: { known: true, value: 0 } }),
    ]);
    expect(result.unreadByLogTurn.size).toBe(0);
    expect(result.sessionUnknownReasons).toEqual([]);
    for (const run of allRuns(result)) {
      expect(subagentRunUsageSchema.safeParse(run).success).toBe(true);
    }
  });

  it("reads a referenced file once, never again as an orphan", async () => {
    const { result, reads } = await attributeFixture("run-and-search");

    expect(reads.sort()).toEqual(["runSubagent-Explore-call_fixturerun1.jsonl", "searchSubagent-call_fixturesearch1.jsonl"]);
    expect(allRuns(result)).toHaveLength(2);
    expect(allRuns(result).every((run) => run.attribution === "child-session-ref")).toBe(true);
  });

  it("dangling ref: the turn that started the run and the session become unknown (D7)", async () => {
    const { result } = await attributeFixture("dangling-ref");

    expect(result.byLogTurn.size).toBe(0);
    expect([...result.unreadByLogTurn]).toEqual([[0, SUBAGENT_LOG_MISSING_REASON]]);
    expect(result.sessionUnknownReasons).toEqual([SUBAGENT_LOG_MISSING_REASON]);
  });

  it("traversal ref: the name is rejected without reading anything outside the folder", async () => {
    const { result, reads } = await attributeFixture("traversal-ref");

    expect(reads).toEqual([]);
    expect([...result.unreadByLogTurn]).toEqual([[0, SUBAGENT_LOG_NAME_REJECTED_REASON]]);
    expect(result.sessionUnknownReasons).toEqual([SUBAGENT_LOG_NAME_REJECTED_REASON]);
  });

  it("nested ref (D6): the run is placed with unknown figures and the session is unknown", async () => {
    const { result } = await attributeFixture("nested-ref");

    expect(runsOn(result, 0)).toEqual([
      expect.objectContaining({ id: "call_fixturenest", costAiCredits: { known: false, reason: NESTED_SUBAGENTS_REASON } }),
    ]);
    expect(result.sessionUnknownReasons).toEqual([NESTED_SUBAGENTS_REASON]);
  });

  it("a request without numeric AI Credits: the run is placed, its AI Credits and the session's unknown", async () => {
    const { result } = await attributeFixture("request-without-credits");

    expect(runsOn(result, 0)).toEqual([
      expect.objectContaining({
        id: "call_fixturenoaiu",
        costAiCredits: { known: false, reason: AI_CREDITS_NOT_AVAILABLE_REASON },
        uncachedInput: { known: true, value: 1000 },
      }),
    ]);
    expect(result.sessionUnknownReasons).toEqual([AI_CREDITS_NOT_AVAILABLE_REASON]);
  });

  it("a live run's partial last line is skipped and the run stays known", async () => {
    const { result } = await attributeFixture("partial-last-line");

    expect(runsOn(result, 0)).toEqual([
      expect.objectContaining({ id: "call_fixturepart", costAiCredits: { known: true, value: expect.closeTo(0.5, 9) } }),
    ]);
    expect(result.sessionUnknownReasons).toEqual([]);
  });

  it("ref before the first user_message: unplaceable, the session is unknown, the file is neither read nor an orphan", async () => {
    const { result, reads } = await attributeFixture("ref-before-first-turn");

    expect(reads).toEqual([]);
    expect(result.byLogTurn.size).toBe(0);
    expect(result.unreadByLogTurn.size).toBe(0);
    expect(result.sessionUnknownReasons).toEqual([SUBAGENT_REF_BEFORE_FIRST_TURN_REASON]);
  });

  it("orphan whose parentSessionId is the folder's and whose start falls in a turn's window (D5): matched by time", async () => {
    const { result } = await attributeFixture("orphan-by-time");

    expect([...result.byLogTurn.keys()]).toEqual([1]);
    expect(runsOn(result, 1)).toEqual([
      expect.objectContaining({
        id: "call_fixtureorphan1",
        label: "runSubagent-Plan",
        attribution: "timestamp",
        costAiCredits: { known: true, value: expect.closeTo(0.5, 9) },
      }),
    ]);
    expect(result.sessionUnknownReasons).toEqual([]);
    expect(subagentRunUsageSchema.safeParse(runsOn(result, 1)[0]).success).toBe(true);
  });

  it("orphan of another session (and before the first turn): unplaceable, turn figures untouched", async () => {
    const { result } = await attributeFixture("orphan-unplaceable");

    expect(result.byLogTurn.size).toBe(0);
    expect(result.unreadByLogTurn.size).toBe(0);
    expect(result.sessionUnknownReasons).toEqual([SUBAGENT_RUN_UNPLACEABLE_REASON]);
  });

  it("the same orphan file is matched when the folder id names its parent session", async () => {
    const { result } = await attributeFolder(path.join(fixturesDir, "orphan-unplaceable"), "other-session");

    // Its start (+100 ms) is still before the first user_message (+10 s).
    expect(result.sessionUnknownReasons).toEqual([SUBAGENT_RUN_UNPLACEABLE_REASON]);
  });

  // The design's promise: a known total never leaves a request out. For every
  // fixture folder, either the session is unknown or the placed runs hold
  // every AI Credit of every subagent file in the folder.
  it.each(readdirSync(fixturesDir))("%s: no known total leaves a subagent request out", async (caseName) => {
    const dir = path.join(fixturesDir, caseName);
    const { result } = await attributeFixture(caseName);

    if (result.sessionUnknownReasons.length > 0) {
      return;
    }
    const placed = allRuns(result).reduce((total, run) => total + (run.costAiCredits.known ? run.costAiCredits.value : NaN), 0);
    expect(placed).toBeCloseTo(nanoAiuInSubagentFiles(dir) / 1_000_000_000, 9);
  });
});

// Independent of the reader: every copilotUsageNanoAiu in the folder's
// subagent files, whatever the reader makes of them.
function nanoAiuInSubagentFiles(dir: string): number {
  let total = 0;
  for (const name of readdirSync(dir).filter((file) => SUBAGENT_LOG_NAME.test(file))) {
    for (const line of readFileSync(path.join(dir, name), "utf-8").split("\n")) {
      try {
        const parsed = JSON.parse(line) as { type?: string; attrs?: { copilotUsageNanoAiu?: unknown } };
        if (parsed.type === "llm_request") {
          total += Number(parsed.attrs?.copilotUsageNanoAiu ?? NaN);
        }
      } catch {
        // A partial line holds no complete request.
      }
    }
  }
  return total;
}

// ---- rules no fixture folder holds, through a fake source -------------------

type FakeFile = JsonlEnvelope[] | "directory" | "read-fails";

interface FakeOptions {
  listing?: { tooMany?: boolean; unreadable?: boolean };
}

function fakeSource(files: Record<string, FakeFile>, options: FakeOptions = {}): Recorded {
  return recording({
    resolve: (name) => {
      if (!SUBAGENT_LOG_NAME.test(name)) {
        return { status: "invalid-name" };
      }
      const file = files[name];
      if (file === undefined) {
        return { status: "missing" };
      }
      return file === "directory" ? { status: "not-a-regular-file" } : { status: "found", path: name };
    },
    list: () => ({
      fileNames: options.listing?.unreadable ? [] : Object.keys(files).sort(),
      tooMany: options.listing?.tooMany ?? false,
      unreadable: options.listing?.unreadable ?? false,
    }),
    read: async (name) => {
      const file = files[name];
      if (file === "read-fails" || file === "directory" || file === undefined) {
        throw new Error("EACCES");
      }
      return { envelopes: file, rawLineCount: file.length };
    },
  });
}

interface RunLogOptions {
  sid: string;
  label?: string;
  parentSessionId?: string;
  at?: number | null; // ms after BASE; null = no ts on session_start
  nanoAiu?: number;
}

function runLog({ sid, label = "runSubagent-Explore", parentSessionId = "sess", at = 11_600, nanoAiu = 250_000_000 }: RunLogOptions): JsonlEnvelope[] {
  const start: JsonlEnvelope = { type: "session_start", sid, attrs: { parentSessionId, label } };
  if (at !== null) {
    start.ts = BASE + at;
  }
  return [
    start,
    {
      type: "llm_request",
      ts: BASE + (at ?? 0) + 100,
      attrs: { inputTokens: 100, outputTokens: 10, cachedTokens: 0, copilotUsageNanoAiu: nanoAiu, model: "fake-sub-model" },
    },
  ];
}

function ref(fileName: string | null, logTurnIndex: number | null, overrides: Partial<ChildSessionRef> = {}): ChildSessionRef {
  const sid = fileName?.replace(/^.*-(call_[A-Za-z0-9]+)\.jsonl$/, "$1") ?? null;
  return {
    logTurnIndex,
    childSessionId: sid,
    childLogFile: fileName,
    label: "runSubagent-Explore",
    ts: null,
    parentSpanId: null,
    ...overrides,
  };
}

const TWO_TURNS = [BASE + 10_000, BASE + 20_000];

async function attribute(
  files: Record<string, FakeFile>,
  refs: ChildSessionRef[],
  { logTurnStarts = TWO_TURNS, folderId = "sess", ...options }: FakeOptions & { logTurnStarts?: (number | null)[]; folderId?: string } = {},
) {
  const recorded = fakeSource(files, options);
  const result = await attributeSubagentRuns({ folderId, refs, logTurnStarts, source: recorded.source });
  return { result, reads: recorded.reads };
}

const FILE_A = "runSubagent-Explore-call_a.jsonl";
const FILE_B = "runSubagent-Explore-call_b.jsonl";
const ORPHAN = "runSubagent-Plan-call_orphan.jsonl";

describe("attributeSubagentRuns: refs (design §4.3, plan §4.4)", () => {
  it("reads nothing when the folder has no ref and no subagent log", async () => {
    const { result, reads } = await attribute({}, []);

    expect(reads).toEqual([]);
    expect(result).toEqual({ byLogTurn: new Map(), unreadByLogTurn: new Map(), sessionUnknownReasons: [] });
  });

  it("keeps several runs of one turn in ref order", async () => {
    const { result } = await attribute(
      { [FILE_A]: runLog({ sid: "call_a" }), [FILE_B]: runLog({ sid: "call_b" }) },
      [ref(FILE_B, 0), ref(FILE_A, 0)],
    );

    expect(runsOn(result, 0).map((run) => run.id)).toEqual(["call_b", "call_a"]);
    expect(result.sessionUnknownReasons).toEqual([]);
  });

  it("a ref without a childLogFile is rejected like a bad name", async () => {
    const { result } = await attribute({}, [ref(null, 0)]);

    expect([...result.unreadByLogTurn]).toEqual([[0, SUBAGENT_LOG_NAME_REJECTED_REASON]]);
    expect(result.sessionUnknownReasons).toEqual([SUBAGENT_LOG_NAME_REJECTED_REASON]);
  });

  it("a referenced file that is not a regular file makes its turn and the session unknown", async () => {
    const { result, reads } = await attribute({ [FILE_A]: "directory" }, [ref(FILE_A, 1)]);

    expect(reads).toEqual([]);
    expect([...result.unreadByLogTurn]).toEqual([[1, SUBAGENT_LOG_NOT_REGULAR_FILE_REASON]]);
    expect(result.sessionUnknownReasons).toEqual([SUBAGENT_LOG_NOT_REGULAR_FILE_REASON]);
  });

  it("a referenced file that fails to read makes its turn and the session unknown", async () => {
    const { result } = await attribute({ [FILE_A]: "read-fails" }, [ref(FILE_A, 0)]);

    expect([...result.unreadByLogTurn]).toEqual([[0, SUBAGENT_LOG_READ_FAILED_REASON]]);
    expect(result.sessionUnknownReasons).toEqual([SUBAGENT_LOG_READ_FAILED_REASON]);
  });

  it("a referenced file with no readable event (unreadable run) makes its turn and the session unknown", async () => {
    const { result } = await attribute({ [FILE_A]: [] }, [ref(FILE_A, 0)]);

    expect(result.byLogTurn.size).toBe(0);
    expect([...result.unreadByLogTurn]).toEqual([[0, "The subagent log has no readable events."]]);
    expect(result.sessionUnknownReasons).toEqual(["The subagent log has no readable events."]);
  });

  it("an unread run on one turn leaves the other turn's run placed, and the session unknown", async () => {
    const { result } = await attribute({ [FILE_B]: runLog({ sid: "call_b" }) }, [ref(FILE_A, 0), ref(FILE_B, 1)]);

    expect(runsOn(result, 1).map((run) => run.id)).toEqual(["call_b"]);
    expect([...result.unreadByLogTurn]).toEqual([[0, SUBAGENT_LOG_MISSING_REASON]]);
    expect(result.sessionUnknownReasons).toEqual([SUBAGENT_LOG_MISSING_REASON]);
  });

  it("keeps the first reason per turn and every distinct reason once for the session", async () => {
    const { result } = await attribute({ [FILE_B]: "directory" }, [
      ref(FILE_A, 0),
      ref("runSubagent-Explore-call_c.jsonl", 0),
      ref(FILE_B, 0),
    ]);

    expect([...result.unreadByLogTurn]).toEqual([[0, SUBAGENT_LOG_MISSING_REASON]]);
    expect(result.sessionUnknownReasons).toEqual([SUBAGENT_LOG_MISSING_REASON, SUBAGENT_LOG_NOT_REGULAR_FILE_REASON]);
  });

  it("two refs naming the same file count its run once, on the first ref's turn", async () => {
    const { result, reads } = await attribute({ [FILE_A]: runLog({ sid: "call_a" }) }, [ref(FILE_A, 0), ref(FILE_A, 1)]);

    expect(reads).toEqual([FILE_A]);
    expect(allRuns(result).map((run) => run.id)).toEqual(["call_a"]);
    expect(runsOn(result, 0)).toHaveLength(1);
  });

  it("a ref before the first turn is unplaceable even when its file reads fine", async () => {
    const { result, reads } = await attribute({ [FILE_A]: runLog({ sid: "call_a", at: 500 }) }, [ref(FILE_A, null)]);

    expect(reads).toEqual([]);
    expect(result.byLogTurn.size).toBe(0);
    expect(result.sessionUnknownReasons).toEqual([SUBAGENT_REF_BEFORE_FIRST_TURN_REASON]);
  });
});

describe("attributeSubagentRuns: the folder listing", () => {
  it("too many subagent logs: nothing is read, every ref's turn and the session are unknown", async () => {
    const { result, reads } = await attribute(
      { [FILE_A]: runLog({ sid: "call_a" }), [ORPHAN]: runLog({ sid: "call_orphan", at: 21_000 }) },
      [ref(FILE_A, 1), ref(null, null)],
      { listing: { tooMany: true } },
    );

    expect(reads).toEqual([]);
    expect(result.byLogTurn.size).toBe(0);
    expect([...result.unreadByLogTurn]).toEqual([[1, SUBAGENT_LOGS_TOO_MANY_REASON]]);
    expect(result.sessionUnknownReasons).toEqual([SUBAGENT_LOGS_TOO_MANY_REASON]);
  });

  it("an unreadable folder: refs are still placed, the session is unknown (orphans may be hidden)", async () => {
    const { result } = await attribute({ [FILE_A]: runLog({ sid: "call_a" }) }, [ref(FILE_A, 0)], {
      listing: { unreadable: true },
    });

    expect(runsOn(result, 0).map((run) => run.id)).toEqual(["call_a"]);
    expect(result.unreadByLogTurn.size).toBe(0);
    expect(result.sessionUnknownReasons).toEqual([SUBAGENT_FOLDER_UNREADABLE_REASON]);
  });
});

describe("attributeSubagentRuns: orphans (D5)", () => {
  const orphanAt = (at: number | null, parentSessionId = "sess") => ({
    [ORPHAN]: runLog({ sid: "call_orphan", label: "runSubagent-Plan", at, parentSessionId }),
  });

  it.each([
    ["inside the first turn", 15_000, 0],
    ["at the second turn's user_message", 20_000, 1],
    ["after the last turn's user_message", 99_000, 1],
    ["at the first turn's user_message", 10_000, 0],
  ])("starting %s: matched by time to that turn", async (_label, at, logTurn) => {
    const { result } = await attribute(orphanAt(at), []);

    expect([...result.byLogTurn.keys()]).toEqual([logTurn]);
    expect(runsOn(result, logTurn)).toEqual([
      expect.objectContaining({ id: "call_orphan", label: "runSubagent-Plan", attribution: "timestamp" }),
    ]);
    expect(result.sessionUnknownReasons).toEqual([]);
  });

  it.each<[string, Record<string, FakeFile>, (number | null)[]]>([
    ["of another session", orphanAt(15_000, "other-session"), TWO_TURNS],
    ["before the first turn", orphanAt(9_999), TWO_TURNS],
    ["without a start time", orphanAt(null), TWO_TURNS],
    ["in a session with no turns", orphanAt(15_000), []],
    ["whose turn window has no start time", orphanAt(15_000), [null, BASE + 20_000]],
    ["whose turn window has no end time", orphanAt(15_000), [BASE + 10_000, null, BASE + 30_000]],
    // Clock skew: windows [10 s, 30 s) and [20 s, ∞) both hold 25 s.
    ["in two overlapping turn windows", orphanAt(25_000), [BASE + 10_000, BASE + 30_000, BASE + 20_000]],
  ])("an orphan %s is unplaceable: the session is unknown, turn figures untouched", async (_label, files, logTurnStarts) => {
    const { result } = await attribute(files, [], { logTurnStarts });

    expect(result.byLogTurn.size).toBe(0);
    expect(result.unreadByLogTurn.size).toBe(0);
    expect(result.sessionUnknownReasons).toEqual([SUBAGENT_RUN_UNPLACEABLE_REASON]);
  });

  it("an orphan whose session_start names no parent session is unplaceable", async () => {
    const log = runLog({ sid: "call_orphan", label: "runSubagent-Plan", at: 15_000 });
    log[0] = { ...log[0], attrs: { label: "runSubagent-Plan" } };

    const { result } = await attribute({ [ORPHAN]: log }, []);

    expect(result.sessionUnknownReasons).toEqual([SUBAGENT_RUN_UNPLACEABLE_REASON]);
  });

  it.each<[string, FakeFile, string]>([
    ["not a regular file", "directory", SUBAGENT_LOG_NOT_REGULAR_FILE_REASON],
    ["failing to read", "read-fails", SUBAGENT_LOG_READ_FAILED_REASON],
    ["with no readable event", [], "The subagent log has no readable events."],
  ])("an orphan %s makes the session unknown", async (_label, file, reason) => {
    const { result } = await attribute({ [ORPHAN]: file }, []);

    expect(result.byLogTurn.size).toBe(0);
    expect(result.unreadByLogTurn.size).toBe(0);
    expect(result.sessionUnknownReasons).toEqual([reason]);
  });

  it("an orphan with unknown AI Credits is placed and makes the session unknown", async () => {
    const log = runLog({ sid: "call_orphan", label: "runSubagent-Plan", at: 15_000 });
    log.push({ type: "child_session_ref", attrs: { childLogFile: "runSubagent-X-call_deeper.jsonl" } });

    const { result } = await attribute({ [ORPHAN]: log }, []);

    expect(runsOn(result, 0)).toEqual([
      expect.objectContaining({ id: "call_orphan", attribution: "timestamp", costAiCredits: { known: false, reason: NESTED_SUBAGENTS_REASON } }),
    ]);
    expect(result.sessionUnknownReasons).toEqual([NESTED_SUBAGENTS_REASON]);
  });

  it("puts orphans after the turn's referenced runs, in start order", async () => {
    const late = "runSubagent-Plan-call_late.jsonl";
    const early = "searchSubagent-call_early.jsonl";
    const { result } = await attribute(
      {
        [FILE_A]: runLog({ sid: "call_a", at: 11_000 }),
        [late]: runLog({ sid: "call_late", label: "runSubagent-Plan", at: 13_000 }),
        [early]: runLog({ sid: "call_early", label: "searchSubagent", at: 12_000 }),
      },
      [ref(FILE_A, 0)],
    );

    expect(runsOn(result, 0).map((run) => [run.id, run.attribution])).toEqual([
      ["call_a", "child-session-ref"],
      ["call_early", "timestamp"],
      ["call_late", "timestamp"],
    ]);
  });

  it("a referenced file is never also an orphan, even when its ref was rejected", async () => {
    const { result, reads } = await attribute({ [FILE_A]: runLog({ sid: "call_a", at: 15_000 }) }, [ref(FILE_A, null)]);

    expect(reads).toEqual([]);
    expect(result.byLogTurn.size).toBe(0);
    expect(result.sessionUnknownReasons).toEqual([SUBAGENT_REF_BEFORE_FIRST_TURN_REASON]);
  });
});

describe("attributeSubagentRuns through the file-system adapter", () => {
  let root: string;
  let sessionDir: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "aca-subagent-attribution-"));
    sessionDir = path.join(root, "sess");
    mkdirSync(sessionDir);
    writeFileSync(
      path.join(sessionDir, "main.jsonl"),
      [
        { type: "session_start", ts: BASE, sid: "sess" },
        { type: "user_message", ts: BASE + 10_000, attrs: { content: "Fixture prompt 1" } },
        { type: "child_session_ref", ts: BASE + 11_500, attrs: { childSessionId: "call_link", childLogFile: "runSubagent-Explore-call_link.jsonl", label: "runSubagent-Explore" } },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n"),
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses a symlinked subagent log: its turn and the session are unknown, the target is never read", async () => {
    const target = path.join(root, "elsewhere.jsonl");
    writeFileSync(target, runLog({ sid: "call_link" }).map((line) => JSON.stringify(line)).join("\n"));
    symlinkSync(target, path.join(sessionDir, "runSubagent-Explore-call_link.jsonl"));

    const { result, reads } = await attributeFolder(sessionDir);

    expect(reads).toEqual([]);
    expect([...result.unreadByLogTurn]).toEqual([[0, SUBAGENT_LOG_NOT_REGULAR_FILE_REASON]]);
    expect(result.sessionUnknownReasons).toEqual([SUBAGENT_LOG_NOT_REGULAR_FILE_REASON]);
  });

  it("reports an unreadable session folder", async () => {
    const { result } = await attributeFolder(sessionDir, "sess", folderSubagentLogSource(path.join(root, "gone")));

    expect(result.sessionUnknownReasons).toContain(SUBAGENT_FOLDER_UNREADABLE_REASON);
  });
});

describe("logTurnStartTimes", () => {
  it("gives each user_message's ts in log order, null where it has none", () => {
    expect(
      logTurnStartTimes([
        { type: "session_start", ts: 1 },
        { type: "user_message", ts: 10 },
        { type: "llm_request", ts: 11 },
        { type: "user_message" },
        { type: "user_message", ts: Number.NaN },
        { type: "user_message", ts: 30 },
      ]),
    ).toEqual([10, null, null, 30]);
  });
});

describe("logTurnAt", () => {
  it.each<[number, (number | null)[], number | null]>([
    [5, [10, 20], null],
    [10, [10, 20], 0],
    [19, [10, 20], 0],
    [20, [10, 20], 1],
    [1e15, [10, 20], 1],
    [15, [], null],
    [Number.NaN, [10, 20], null],
  ])("places %d among %j at %j", (at, starts, expected) => {
    expect(logTurnAt(starts, at)).toBe(expected);
  });
});
