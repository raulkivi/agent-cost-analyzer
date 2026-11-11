// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { buildEvidence } from "./build.mts";
import type { GitResult, GitRunner } from "./git-notes.mts";
import { readRunFacts, recordEvidence } from "./record.mts";

const SHA = "0123456789abcdef0123456789abcdef01234567";

function fakeGit(answers: Record<string, GitResult>): GitRunner & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    run(args) {
      calls.push([...args]);
      const answer = answers[args[0]!];
      if (!answer) throw new Error(`unexpected git ${args.join(" ")}`);
      return answer;
    },
  };
}

const ok = (stdout = ""): GitResult => ({ status: 0, stdout, stderr: "" });

describe("readRunFacts (taken when the run starts)", () => {
  it("records HEAD's full SHA and whether the tree had changes", () => {
    const git = fakeGit({ "rev-parse": ok(`${SHA}\n`), status: ok(" M src/extension.ts\n") });
    const now = new Date("2026-11-11T10:00:00.000Z");

    expect(readRunFacts(git, { extensionVersion: "0.6.0", vscodeVersion: "1.145.0", requestedModel: "m", now })).toEqual({
      commit: SHA,
      dirty: true,
      extensionVersion: "0.6.0",
      vscodeVersion: "1.145.0",
      requestedModel: "m",
      ranAt: now,
    });
    expect(git.calls.map((args) => args.slice(0, 2))).toEqual([
      ["rev-parse", "--verify"],
      ["status", "--porcelain"],
    ]);
  });
});

describe("recordEvidence (the run's onComplete)", () => {
  const facts = { commit: SHA, dirty: false, extensionVersion: "0.6.0", vscodeVersion: "1.145.0", requestedModel: "m", ranAt: new Date("2026-11-11T10:00:00.000Z") };

  function record(results: Parameters<typeof buildEvidence>[1]) {
    const git = fakeGit({ notes: ok() });
    const files = new Map<string, string>();
    const lines: string[] = [];
    recordEvidence({ git, writeFile: (file, text) => files.set(file, text), log: (line) => lines.push(line) }, buildEvidence(facts, results, []), "/run/evidence.json");
    return { git, files, text: lines.join("\n") };
  }

  it("writes the record to the file and adds it as the commit's note, never pushing", () => {
    const { git, files } = record([]);

    expect(JSON.parse(files.get("/run/evidence.json")!)).toMatchObject({ schema: 1, commit: SHA });
    expect(files.get("/run/evidence.json")!.endsWith("\n")).toBe(true);
    expect(git.calls).toEqual([["notes", "--ref=release-ui", "add", "-f", "-F", "/run/evidence.json", SHA]]);
    expect(git.calls.flat()).not.toContain("push");
  });

  it("prints the verdict and the push command for a passing run", () => {
    const { text } = record(["1.4", "2.3", "2.4"].map((id) => ({ title: `${id} t`, parent: "S", state: "passed" as const })));

    expect(text).toContain("PASS");
    expect(text).toContain("git push origin refs/notes/release-ui");
  });

  it("still records a run the gate refuses, and says the gate will refuse it", () => {
    const { git, text } = record([{ title: "1.4 t", parent: "S", state: "skipped" }]);

    expect(git.calls).toHaveLength(1);
    expect(text).toMatch(/BLOCKED/);
    expect(text).toMatch(/release gate will refuse/i);
  });
});
