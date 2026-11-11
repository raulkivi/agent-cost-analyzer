// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Reads a commit's release evidence note and judges it (evidence.mts). The
// release workflow runs it on the tagged commit; the owner runs it before
// tagging (`npm run release:evidence`).
import { evaluateNote, judgeEvidence, REQUIRED_COPILOT_E2E_TESTS, type ReleaseEvidence, type Verdict } from "./evidence.mts";
import { type GitRunner, readNote, resolveCommit } from "./git-notes.mts";

export interface EvidenceCheck extends Verdict {
  commit: string;
}

export function checkReleaseEvidence(git: GitRunner, revision: string): EvidenceCheck {
  const commit = resolveCommit(git, revision);
  return { commit, ...evaluateNote(readNote(git, commit), { commit, requiredTests: REQUIRED_COPILOT_E2E_TESTS }) };
}

// The verdict the gate would give a record on its own commit, for the run to print.
export function checkFromEvidence(evidence: ReleaseEvidence): EvidenceCheck {
  const commit = evidence.commit;
  return { commit, evidence, problems: judgeEvidence(evidence, { commit, requiredTests: REQUIRED_COPILOT_E2E_TESTS }) };
}

export function renderVerdict(check: EvidenceCheck): string[] {
  const lines = [`Release evidence for ${check.commit} (refs/notes/release-ui):`];
  const evidence = check.evidence;
  if (evidence) {
    const observed = evidence.model.observed.length === 0 ? "none" : evidence.model.observed.join(", ");
    lines.push(
      `  suite ${evidence.suite}, ran ${evidence.ranAt}${evidence.dirty ? ", working tree had changes" : ""}`,
      `  extension ${evidence.extensionVersion}, VS Code ${evidence.vscodeVersion}, model ${evidence.model.requested} (observed: ${observed})`,
      ...evidence.tests.map((test) => `  ${test.state.padEnd(8)} ${test.title}${test.skipReason === null ? "" : ` (${test.skipReason})`}`),
      `  AI Credits spent: ${evidence.aiCreditsSpent === null ? "unknown" : evidence.aiCreditsSpent.toFixed(4)}`,
    );
  }
  if (check.problems.length === 0) {
    lines.push("PASS: the release gate accepts this commit.");
    return lines;
  }
  const count = check.problems.length;
  lines.push(`BLOCKED: ${count} problem${count === 1 ? "" : "s"}:`, ...check.problems.map((problem) => `  - [${problem.code}] ${problem.message}`));
  return lines;
}
