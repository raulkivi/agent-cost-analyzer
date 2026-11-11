// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type GitResult,
  type GitRunner,
  isWorkingTreeDirty,
  nodeGit,
  PUSH_NOTES_COMMAND,
  readNote,
  RELEASE_UI_NOTES_REF,
  resolveCommit,
  writeNote,
} from "./git-notes.mts";

const SHA = "0123456789abcdef0123456789abcdef01234567";

// Answers each call with the next canned result and records the arguments.
function fakeGit(...answers: GitResult[]): GitRunner & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    run(args) {
      calls.push([...args]);
      const answer = answers.shift();
      if (!answer) throw new Error(`unexpected git ${args.join(" ")}`);
      return answer;
    },
  };
}

const ok = (stdout = ""): GitResult => ({ status: 0, stdout, stderr: "" });
const fail = (stderr: string, status = 1): GitResult => ({ status, stdout: "", stderr });

describe("git commands of the release evidence (fake git)", () => {
  it("names the notes ref and the push command, which the run prints and never runs", () => {
    expect(RELEASE_UI_NOTES_REF).toBe("refs/notes/release-ui");
    expect(PUSH_NOTES_COMMAND).toBe("git push origin refs/notes/release-ui");
  });

  it("resolves a revision to its full commit SHA", () => {
    const git = fakeGit(ok(`${SHA}\n`));
    expect(resolveCommit(git, "ext-v0.6.0")).toBe(SHA);
    expect(git.calls).toEqual([["rev-parse", "--verify", "--end-of-options", "ext-v0.6.0^{commit}"]]);
  });

  it("refuses a revision git can't resolve, with git's words", () => {
    expect(() => resolveCommit(fakeGit(fail("fatal: Needed a single revision")), "nope")).toThrow(/nope[\s\S]*Needed a single revision/);
  });

  it("calls a tree with any tracked or untracked change dirty", () => {
    const clean = fakeGit(ok(""));
    expect(isWorkingTreeDirty(clean)).toBe(false);
    expect(clean.calls).toEqual([["status", "--porcelain", "--untracked-files=normal"]]);
    expect(isWorkingTreeDirty(fakeGit(ok("?? notes.txt\n")))).toBe(true);
  });

  it("writes the note from a file, replacing an earlier one on the same commit", () => {
    const git = fakeGit(ok());
    writeNote(git, SHA, "/tmp/evidence.json");
    expect(git.calls).toEqual([["notes", "--ref=release-ui", "add", "-f", "-F", "/tmp/evidence.json", SHA]]);
  });

  it("fails loudly when git can't write the note", () => {
    expect(() => writeNote(fakeGit(fail("fatal: bad object")), SHA, "/tmp/e.json")).toThrow(/bad object/);
  });

  it("reads the note of a commit", () => {
    const git = fakeGit(ok('{"schema":1}\n'));
    expect(readNote(git, SHA)).toBe('{"schema":1}\n');
    expect(git.calls).toEqual([["notes", "--ref=release-ui", "show", SHA]]);
  });

  it("reads no note as undefined, and any other git failure as an error", () => {
    expect(readNote(fakeGit(fail(`error: no note found for object ${SHA}.`)), SHA)).toBeUndefined();
    expect(() => readNote(fakeGit(fail("fatal: not a git repository", 128)), SHA)).toThrow(/not a git repository/);
  });
});

describe("nodeGit against a temporary repository", () => {
  let dir: string;
  let git: GitRunner;
  let commit: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "aica-evidence-git-"));
    git = nodeGit(dir);
    for (const args of [["init", "-q"], ["config", "user.name", "Test"], ["config", "user.email", "test@example.invalid"], ["config", "commit.gpgsign", "false"]]) {
      expect(git.run(args).status).toBe(0);
    }
    writeFileSync(path.join(dir, "a.txt"), "a\n");
    git.run(["add", "a.txt"]);
    expect(git.run(["commit", "-q", "-m", "one"]).status).toBe(0);
    commit = resolveCommit(git, "HEAD");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes, reads back and replaces a note, and sees no note on a commit without one", () => {
    expect(commit).toMatch(/^[0-9a-f]{40}$/);
    expect(readNote(git, commit)).toBeUndefined();

    const file = path.join(dir, "..", `${path.basename(dir)}-note.json`);
    writeFileSync(file, '{"run":1}\n');
    writeNote(git, commit, file);
    writeFileSync(file, '{"run":2}\n');
    writeNote(git, commit, file);
    rmSync(file);

    expect(readNote(git, commit)).toBe('{"run":2}\n');
    expect(isWorkingTreeDirty(git)).toBe(false);
    writeFileSync(path.join(dir, "b.txt"), "b\n");
    expect(isWorkingTreeDirty(git)).toBe(true);
  });
});
