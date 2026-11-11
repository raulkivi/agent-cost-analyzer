// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { checkFromEvidence, checkReleaseEvidence, renderVerdict } from "./check.mts";
import type { GitResult, GitRunner } from "./git-notes.mts";
import type { ReleaseEvidence } from "./evidence.mts";

const SHA = "0123456789abcdef0123456789abcdef01234567";

// Fixture notes, as `git notes --ref=release-ui show` prints them.
const PASSING: ReleaseEvidence = {
  schema: 1,
  suite: "copilot-e2e",
  commit: SHA,
  dirty: false,
  extensionVersion: "0.6.0",
  vscodeVersion: "1.145.0",
  model: { requested: "claude-haiku-5.5", observed: ["claude-haiku-5-5"] },
  tests: [
    { title: "1.4 a real agent-mode chat", state: "passed", skipReason: null },
    { title: "2.3 asked to call an MCP tool", state: "passed", skipReason: null },
    { title: "2.4 asked about another agent's sessions", state: "passed", skipReason: null },
  ],
  aiCreditsSpent: 0.0421,
  ranAt: "2026-11-11T10:00:00.000Z",
};
const ALL_SKIPPED: ReleaseEvidence = {
  ...PASSING,
  model: { requested: "claude-haiku-5.5", observed: [] },
  tests: PASSING.tests.map((test) => ({ ...test, state: "skipped", skipReason: "no GitHub account is signed in in the copied profile" })),
  aiCreditsSpent: null,
};
const note = (evidence: ReleaseEvidence): string => `${JSON.stringify(evidence, null, 2)}\n`;

// Answers rev-parse with SHA and notes show with `noteText` (undefined: no note).
function gitWithNote(noteText: string | undefined): GitRunner {
  return {
    run(args): GitResult {
      if (args[0] === "rev-parse") return { status: 0, stdout: `${SHA}\n`, stderr: "" };
      if (args[0] === "notes" && args[2] === "show") {
        return noteText === undefined ? { status: 1, stdout: "", stderr: `error: no note found for object ${SHA}.` } : { status: 0, stdout: noteText, stderr: "" };
      }
      throw new Error(`unexpected git ${args.join(" ")}`);
    },
  };
}

describe("checkReleaseEvidence (the release workflow's gate, D1)", () => {
  it("passes a clean all-green run on the commit", () => {
    const result = checkReleaseEvidence(gitWithNote(note(PASSING)), "HEAD");
    expect(result).toEqual({ commit: SHA, evidence: PASSING, problems: [] });
  });

  it("refuses a commit without a note", () => {
    expect(checkReleaseEvidence(gitWithNote(undefined), "HEAD").problems.map((p) => p.code)).toEqual(["missing-note"]);
  });

  it("refuses a run whose tests were all skipped, one problem per test", () => {
    const result = checkReleaseEvidence(gitWithNote(note(ALL_SKIPPED)), "HEAD");
    expect(result.problems.map((p) => p.code)).toEqual(["test-skipped", "test-skipped", "test-skipped"]);
  });

  it("refuses a malformed note", () => {
    expect(checkReleaseEvidence(gitWithNote("not json"), "HEAD").problems.map((p) => p.code)).toEqual(["malformed"]);
  });
});

describe("checkFromEvidence (the verdict a run prints on its own record)", () => {
  it("judges the record against its own commit", () => {
    expect(checkFromEvidence(PASSING)).toEqual({ commit: SHA, evidence: PASSING, problems: [] });
    expect(checkFromEvidence(ALL_SKIPPED).problems.map((p) => p.code)).toEqual(["test-skipped", "test-skipped", "test-skipped"]);
  });
});

describe("renderVerdict (what the owner and the workflow log read)", () => {
  it("summarises the evidence and says the release may go ahead", () => {
    const text = renderVerdict(checkReleaseEvidence(gitWithNote(note(PASSING)), "HEAD")).join("\n");
    expect(text).toContain(`Release evidence for ${SHA}`);
    expect(text).toContain("extension 0.6.0, VS Code 1.145.0");
    expect(text).toContain("model claude-haiku-5.5 (observed: claude-haiku-5-5)");
    expect(text).toContain("passed   1.4 a real agent-mode chat");
    expect(text).toContain("AI Credits spent: 0.0421");
    expect(text).toMatch(/PASS/);
  });

  it("lists every problem by name, and the skip reason of each skipped test", () => {
    const lines = renderVerdict(checkReleaseEvidence(gitWithNote(note({ ...ALL_SKIPPED, dirty: true })), "HEAD"));
    const text = lines.join("\n");
    expect(text).toContain("skipped  2.3 asked to call an MCP tool (no GitHub account is signed in in the copied profile)");
    expect(text).toContain("observed: none");
    expect(text).toContain("AI Credits spent: unknown");
    expect(text).toMatch(/BLOCKED: 4 problems/);
    expect(lines.filter((line) => /^ {2}- \[(dirty-tree|test-skipped)\]/.test(line))).toHaveLength(4);
  });

  it("names the missing note without an evidence summary", () => {
    const text = renderVerdict(checkReleaseEvidence(gitWithNote(undefined), "HEAD")).join("\n");
    expect(text).toMatch(/BLOCKED: 1 problem\b/);
    expect(text).toContain("[missing-note]");
    expect(text).not.toContain("AI Credits");
  });
});
