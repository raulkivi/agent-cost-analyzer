// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The real-Copilot run's side of the release evidence (D1): facts taken when
// the run starts, and the record written as a git note when it ends, with the
// judge's verdict and the push command printed. It never pushes.
import { checkFromEvidence, renderVerdict } from "./check.mts";
import type { RunFacts } from "./build.mts";
import type { ReleaseEvidence } from "./evidence.mts";
import { type GitRunner, isWorkingTreeDirty, PUSH_NOTES_COMMAND, resolveCommit, writeNote } from "./git-notes.mts";

export interface RunFactsInput {
  extensionVersion: string;
  vscodeVersion: string;
  requestedModel: string;
  now: Date;
}

export function readRunFacts(git: GitRunner, input: RunFactsInput): RunFacts {
  return {
    commit: resolveCommit(git, "HEAD"),
    dirty: isWorkingTreeDirty(git),
    extensionVersion: input.extensionVersion,
    vscodeVersion: input.vscodeVersion,
    requestedModel: input.requestedModel,
    ranAt: input.now,
  };
}

export interface RecordDeps {
  git: GitRunner;
  writeFile(file: string, text: string): void;
  log(line: string): void;
}

export function recordEvidence(deps: RecordDeps, evidence: ReleaseEvidence, file: string): void {
  deps.writeFile(file, `${JSON.stringify(evidence, null, 2)}\n`);
  writeNote(deps.git, evidence.commit, file);
  const check = checkFromEvidence(evidence);
  for (const line of renderVerdict(check)) deps.log(`[copilot-e2e] ${line}`);
  const outcome = check.problems.length === 0 ? "Push it before tagging" : "The release gate will refuse this commit; fix the problems above and rerun. To share the record anyway";
  deps.log(`[copilot-e2e] Written as a git note on ${evidence.commit} (refs/notes/release-ui). ${outcome}: ${PUSH_NOTES_COMMAND}`);
}
