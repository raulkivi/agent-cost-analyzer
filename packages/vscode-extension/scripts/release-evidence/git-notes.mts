// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The git side of the release evidence: the notes ref it lives under, and the
// few commands that read and write it, behind a small runner port so tests
// can answer for git. Nothing here pushes: the owner pushes the notes ref.
import { spawnSync } from "node:child_process";

export const RELEASE_UI_NOTES_REF = "refs/notes/release-ui";
export const PUSH_NOTES_COMMAND = `git push origin ${RELEASE_UI_NOTES_REF}`;
const NOTES_REF_ARG = "--ref=release-ui";

export interface GitResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface GitRunner {
  run(args: readonly string[]): GitResult;
}

export function nodeGit(cwd: string): GitRunner {
  return {
    run(args) {
      const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
      if (result.error) throw result.error;
      return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
    },
  };
}

function failure(what: string, result: GitResult): Error {
  return new Error(`${what}: ${result.stderr.trim() || `git exited with ${result.status}`}`);
}

export function resolveCommit(git: GitRunner, revision: string): string {
  const result = git.run(["rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`]);
  if (result.status !== 0) throw failure(`Can't resolve ${JSON.stringify(revision)} to a commit`, result);
  return result.stdout.trim();
}

// Untracked files count: they can change what the suite builds and runs.
// Ignored files (dist/, test output, the VS Code download) don't.
export function isWorkingTreeDirty(git: GitRunner): boolean {
  const result = git.run(["status", "--porcelain", "--untracked-files=normal"]);
  if (result.status !== 0) throw failure("Can't read the working tree's status", result);
  return result.stdout.trim() !== "";
}

// -f: a later run on the same commit replaces the earlier note, pass or fail.
export function writeNote(git: GitRunner, commit: string, file: string): void {
  const result = git.run(["notes", NOTES_REF_ARG, "add", "-f", "-F", file, commit]);
  if (result.status !== 0) throw failure(`Can't write the release evidence note on ${commit}`, result);
}

export function readNote(git: GitRunner, commit: string): string | undefined {
  const result = git.run(["notes", NOTES_REF_ARG, "show", commit]);
  if (result.status === 0) return result.stdout;
  if (/no note found/i.test(result.stderr)) return undefined;
  throw failure(`Can't read the release evidence note of ${commit}`, result);
}
