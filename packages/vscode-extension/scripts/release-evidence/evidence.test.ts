// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  COPILOT_CHAT_CHECKS,
  COPILOT_EXTENSION_ROWS,
  COPILOT_VIEW_ROWS,
  copilotTestTitle,
  evaluateNote,
  judgeEvidence,
  parseEvidence,
  REQUIRED_COPILOT_E2E_TESTS,
  testIdOf,
  type ReleaseEvidence,
} from "./evidence.mts";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const OTHER_SHA = "fedcba9876543210fedcba9876543210fedcba98";

function evidence(overrides: Partial<ReleaseEvidence> = {}): ReleaseEvidence {
  return {
    schema: 1,
    suite: "copilot-e2e",
    commit: SHA,
    dirty: false,
    extensionVersion: "0.6.0",
    vscodeVersion: "1.145.0",
    model: { requested: "claude-haiku-5.5", observed: ["claude-haiku-5-5"] },
    tests: [
      { title: copilotTestTitle("1.4", "a real chat"), state: "passed", skipReason: null },
      { title: copilotTestTitle("2.3", "an MCP call"), state: "passed", skipReason: null },
      { title: copilotTestTitle("2.4", "another agent"), state: "passed", skipReason: null },
      ...COPILOT_VIEW_ROWS.map((id) => ({ title: copilotTestTitle(id, "a view"), state: "passed" as const, skipReason: null })),
      ...COPILOT_EXTENSION_ROWS.map((id) => ({ title: copilotTestTitle(id, "an extension row"), state: "passed" as const, skipReason: null })),
    ],
    aiCreditsSpent: 0.0123,
    ranAt: "2026-11-11T10:00:00.000Z",
    ...overrides,
  };
}

const expectation = { commit: SHA, requiredTests: REQUIRED_COPILOT_E2E_TESTS };

function codes(problems: { code: string }[]): string[] {
  return problems.map((problem) => problem.code);
}

describe("copilotTestTitle and testIdOf (stable ids, so a renamed test can't drop out)", () => {
  it("puts the check id first and reads it back", () => {
    const title = copilotTestTitle("2.3", "asked to call an MCP tool");
    expect(title).toBe("2.3 asked to call an MCP tool");
    expect(testIdOf(title)).toBe("2.3");
  });

  // G4: the MCP App view rows of the A24 and A16 checklists.
  it.each([
    ["A24 1.1 U9 repository cost over time", "A24 1.1"],
    ["A16 U1 session cost", "A16 U1"],
    ["A16 keyboard Tab and Enter", "A16 keyboard"],
  ])("reads a checklist row id from %j", (title, id) => {
    expect(testIdOf(title)).toBe(id);
  });

  it.each(["asked to call 2.3", "2.3", "2.3-x something", "", "v2.3 something", "A24 1.1", "A24", "B24 1.1 x", "a24 1.1 x"])("finds no id in %j", (title) => {
    expect(testIdOf(title)).toBeUndefined();
  });

  it("names the three real-chat checks and the MCP App view rows (G4) the release needs", () => {
    expect(COPILOT_CHAT_CHECKS).toEqual(["1.4", "2.3", "2.4"]);
    expect(COPILOT_VIEW_ROWS).toEqual([
      "A24 1.1",
      "A24 1.2",
      "A24 1.3",
      "A24 1.4",
      "A24 1.5",
      "A24 1.6",
      "A24 1.7",
      "A24 1.8",
      "A24 1.9",
      "A16 U1",
      "A16 U2",
      "A16 U3",
      "A16 keyboard",
    ]);
    expect(REQUIRED_COPILOT_E2E_TESTS).toEqual([...COPILOT_CHAT_CHECKS, ...COPILOT_VIEW_ROWS, ...COPILOT_EXTENSION_ROWS]);
  });

  // G7 (step 10.17): extension-rows.e2e.ts's 2.1 (Configure Tools) and 1.14 (a real git folder).
  it("requires G7's extension rows 2.1 and 1.14", () => {
    expect(COPILOT_EXTENSION_ROWS).toEqual(["2.1", "1.14"]);
    expect(REQUIRED_COPILOT_E2E_TESTS).toEqual(expect.arrayContaining(["2.1", "1.14"]));
  });

  it("refuses a run without a view row", () => {
    const record = evidence({ tests: evidence().tests.filter((test) => testIdOf(test.title) !== "A24 1.4") });

    expect(codes(judgeEvidence(record, expectation))).toEqual(["test-missing"]);
  });
});

describe("parseEvidence", () => {
  it("round-trips a well-formed record", () => {
    const record = evidence();
    expect(parseEvidence(JSON.stringify(record))).toEqual({ ok: true, evidence: record });
  });

  it("accepts null AI Credits (the run couldn't measure them) and a skip reason", () => {
    const record = evidence({ aiCreditsSpent: null, tests: [{ title: "1.4 x", state: "skipped", skipReason: "ran gpt-6-luna" }] });
    expect(parseEvidence(JSON.stringify(record))).toEqual({ ok: true, evidence: record });
  });

  it("refuses text that isn't JSON", () => {
    const result = parseEvidence("not json");
    expect(result.ok).toBe(false);
    expect(!result.ok && codes(result.problems)).toEqual(["malformed"]);
  });

  it("refuses an unknown schema version by name, before reading the rest", () => {
    const result = parseEvidence(JSON.stringify({ schema: 2, whatever: true }));
    expect(!result.ok && result.problems).toEqual([{ code: "unknown-schema", message: expect.stringContaining("2") }]);
  });

  it.each<[string, unknown]>([
    ["an array", []],
    ["a missing schema", { ...evidence(), schema: undefined }],
    ["another suite", { ...evidence(), suite: "extension-ui" }],
    ["a short commit", { ...evidence(), commit: "0123456" }],
    ["an upper-case commit", { ...evidence(), commit: SHA.toUpperCase() }],
    ["a string dirty flag", { ...evidence(), dirty: "false" }],
    ["an empty extension version", { ...evidence(), extensionVersion: "" }],
    ["a missing VS Code version", { ...evidence(), vscodeVersion: undefined }],
    ["a model without observed ids", { ...evidence(), model: { requested: "m" } }],
    ["a non-string observed id", { ...evidence(), model: { requested: "m", observed: [1] } }],
    ["tests that aren't a list", { ...evidence(), tests: {} }],
    ["a test without a title", { ...evidence(), tests: [{ title: "", state: "passed", skipReason: null }] }],
    ["an unknown test state", { ...evidence(), tests: [{ title: "1.4 x", state: "pending", skipReason: null }] }],
    ["a missing skip reason field", { ...evidence(), tests: [{ title: "1.4 x", state: "passed" }] }],
    ["negative AI Credits", { ...evidence(), aiCreditsSpent: -1 }],
    ["AI Credits as text", { ...evidence(), aiCreditsSpent: "0.1" }],
    ["a date that isn't ISO", { ...evidence(), ranAt: "yesterday" }],
    ["an unknown field", { ...evidence(), passed: true }],
  ])("refuses %s", (_name, value) => {
    const result = parseEvidence(JSON.stringify(value));
    expect(result.ok).toBe(false);
    expect(!result.ok && codes(result.problems)).toEqual(["malformed"]);
  });
});

describe("judgeEvidence (owner decision D1)", () => {
  it("finds nothing wrong with a clean, all-green run on the tagged commit", () => {
    expect(judgeEvidence(evidence(), expectation)).toEqual([]);
  });

  it("refuses a run on another commit, naming both", () => {
    const problems = judgeEvidence(evidence({ commit: OTHER_SHA }), expectation);
    expect(problems).toEqual([{ code: "wrong-commit", message: expect.stringMatching(new RegExp(`${OTHER_SHA}.*${SHA}`)) }]);
  });

  it("refuses a run from a working tree with changes: it didn't test the commit", () => {
    expect(codes(judgeEvidence(evidence({ dirty: true }), expectation))).toEqual(["dirty-tree"]);
  });

  it("refuses a required test that is missing, naming its id", () => {
    const record = evidence({ tests: evidence().tests.filter((test) => testIdOf(test.title) !== "2.4") });
    expect(judgeEvidence(record, expectation)).toEqual([{ code: "test-missing", message: expect.stringContaining("2.4") }]);
  });

  it("refuses a failed required test", () => {
    const record = evidence({ tests: evidence().tests.map((test) => (testIdOf(test.title) === "2.4" ? { title: "2.4 x", state: "failed" as const, skipReason: null } : test)) });
    expect(judgeEvidence(record, expectation)).toEqual([{ code: "test-failed", message: expect.stringContaining("2.4") }]);
  });

  it("refuses a skipped required test even with a reason, and names the reason so the owner reruns", () => {
    const reason = 'the session ran on "gpt-6-luna", not claude-haiku-5.5';
    const record = evidence({ tests: [{ title: "1.4 x", state: "skipped", skipReason: reason }, ...evidence().tests.slice(1)] });
    const problems = judgeEvidence(record, expectation);
    expect(codes(problems)).toEqual(["test-skipped"]);
    expect(problems[0]!.message).toContain("1.4");
    expect(problems[0]!.message).toContain(reason);
    expect(problems[0]!.message).toMatch(/rerun/i);
  });

  it("says so when a skipped required test recorded no reason", () => {
    const record = evidence({ tests: [{ title: "1.4 x", state: "skipped", skipReason: null }, ...evidence().tests.slice(1)] });
    expect(judgeEvidence(record, expectation)[0]!.message).toMatch(/no reason/i);
  });

  it("refuses when any copy of a required test didn't pass (a duplicated id can't hide a failure)", () => {
    const record = evidence({ tests: [...evidence().tests, { title: "2.3 again", state: "failed", skipReason: null }] });
    expect(codes(judgeEvidence(record, expectation))).toEqual(["test-failed"]);
  });

  it("refuses a failure in a test the release doesn't require: a red suite isn't released", () => {
    const record = evidence({ tests: [...evidence().tests, { title: "a later spec", state: "failed", skipReason: null }] });
    expect(judgeEvidence(record, expectation)).toEqual([{ code: "test-failed", message: expect.stringContaining("a later spec") }]);
  });

  it("lets a test the release doesn't require be skipped", () => {
    const record = evidence({ tests: [...evidence().tests, { title: "a later spec", state: "skipped", skipReason: "not yet" }] });
    expect(judgeEvidence(record, expectation)).toEqual([]);
  });

  it("matches the commit regardless of case and lists every problem at once", () => {
    const record = evidence({ commit: OTHER_SHA, dirty: true, tests: [] });
    expect(codes(judgeEvidence(record, { ...expectation, commit: SHA.toUpperCase() }))).toEqual([
      "wrong-commit",
      "dirty-tree",
      ...REQUIRED_COPILOT_E2E_TESTS.map(() => "test-missing"),
    ]);
  });
});

describe("evaluateNote (what the release check runs on the tagged commit's note)", () => {
  it("refuses a commit with no note, saying how to make one", () => {
    expect(evaluateNote(undefined, expectation)).toEqual({
      problems: [{ code: "missing-note", message: expect.stringMatching(/test:ui:vscode:copilot[\s\S]*git push origin refs\/notes\/release-ui/) }],
    });
  });

  it("returns the parse problems of a malformed note", () => {
    expect(codes(evaluateNote("{", expectation).problems)).toEqual(["malformed"]);
  });

  it("returns the evidence and the judge's problems for a well-formed note", () => {
    const record = evidence({ dirty: true });
    expect(evaluateNote(JSON.stringify(record), expectation)).toEqual({ evidence: record, problems: [{ code: "dirty-tree", message: expect.any(String) }] });
  });

  it("accepts the note git prints, with its trailing newline", () => {
    expect(evaluateNote(`${JSON.stringify(evidence(), null, 2)}\n`, expectation)).toEqual({ evidence: evidence(), problems: [] });
  });
});
