// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Release gate for owner decision D1 (docs/plans/release-ui-gate.md, G2):
//   node scripts/release-evidence-check.mts [<revision>]   (default HEAD)
// Reads the commit's note under refs/notes/release-ui (written by the
// real-Copilot run), prints it with the verdict and exits 1 unless the gate
// accepts it. The extension release workflow runs it on the tagged commit;
// `npm run release:evidence` runs it before tagging. Fetch the notes first
// on a fresh clone: git fetch origin refs/notes/release-ui:refs/notes/release-ui
import process from "node:process";
import { checkReleaseEvidence, type EvidenceCheck, renderVerdict } from "./release-evidence/check.mts";
import { nodeGit } from "./release-evidence/git-notes.mts";

const [revision = "HEAD", ...rest] = process.argv.slice(2);
if (rest.length > 0 || revision.startsWith("-")) {
  console.error("Usage: release-evidence-check.mts [<revision>]");
  process.exit(2);
}
let check: EvidenceCheck;
try {
  check = checkReleaseEvidence(nodeGit(process.cwd()), revision);
} catch (error) {
  console.error((error as Error).message);
  process.exit(2);
}
for (const line of renderVerdict(check)) console.log(line);
if (check.problems.some((problem) => problem.code === "missing-note")) {
  console.log("If the note was pushed from another clone, fetch it first: git fetch origin refs/notes/release-ui:refs/notes/release-ui");
}
if (process.env.GITHUB_ACTIONS === "true") {
  for (const problem of check.problems) console.log(`::error title=Release evidence (${problem.code})::${problem.message}`);
}
process.exit(check.problems.length === 0 ? 0 : 1);
