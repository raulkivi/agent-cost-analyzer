// The opt-in, owner-run suite that drives a REAL signed-in Copilot Chat
// (docs/plans/vscode-ui-automation.md §7): checks 1.4, 2.3 and 2.4 with a real
// agent-mode chat, and the MCP App views in that chat (step 10.17 G4,
// copilot-views.e2e.ts). It spends AI Credits, so it is not part of
// `npm run test:ui:vscode`, the extension-ui CI job or `npm test`, and it does
// nothing unless COPILOT_E2E=1 and COPILOT_E2E_USER_DATA_DIR point at the
// throwaway profile you signed in with (`npm run test:ui:vscode:copilot:signin`).
//
//   COPILOT_E2E=1 COPILOT_E2E_USER_DATA_DIR=~/.cache/aica-copilot-e2e/user-data \
//     npm run test:ui:vscode:copilot   (under a display, or xvfb-run -a)
//
// It runs VS Code on a COPY of that profile (profile-copy.mts: only `User` and
// `Local State`), deleted afterwards. It never reads, prints or stores the
// sign-in: VS Code finds it in the copied state. How it launches (the skip,
// the profile copy and its seeding, normal mode, the VS Code arguments) is
// test/ui/copilot-e2e/support/copilot-launch.mts, which the real-Copilot demo
// recordings share; this file adds the release evidence.
//
// Release evidence (owner decision D1, docs/plans/release-ui-gate.md G2): when
// the run ends, onComplete writes its result as a git note on the commit it
// started on (refs/notes/release-ui), dirty tree and skips included, prints
// the release gate's verdict and the push command, and never pushes.
// TDD exception: the hooks below only run in a real wdio run; what they call
// (scripts/release-evidence/) is unit-tested.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { prepareCopilotLaunch } from "./test/ui/copilot-e2e/support/copilot-launch.mts";
import CopilotE2eResultsReporter from "./test/ui/copilot-e2e/support/results-reporter.mts";
import { evidenceDirOf } from "./test/ui/copilot-e2e/support/run-log.mts";
import { buildEvidence, type RunFacts } from "./scripts/release-evidence/build.mts";
import { nodeGit } from "./scripts/release-evidence/git-notes.mts";
import { readRunFacts, recordEvidence } from "./scripts/release-evidence/record.mts";
import { readRunArtifacts } from "./scripts/release-evidence/run-artifacts.mts";
import { PINNED_VSCODE_VERSION } from "./scripts/ui-automation/vscode-version.mts";

// wdio loads this file in the launcher and again in every worker; only the
// launcher prepares the run, reports the skip and takes the run's facts.
const launch = prepareCopilotLaunch();
const { rootDir } = launch.paths;
const evidenceDir = evidenceDirOf(rootDir);
const git = nodeGit(import.meta.dirname);
// Taken when the run starts, so a commit made during the run isn't credited with it.
let runFacts: RunFacts | undefined;
if (!launch.inWorker) {
  const { version } = JSON.parse(readFileSync(path.join(import.meta.dirname, "package.json"), "utf-8")) as { version: string };
  runFacts = readRunFacts(git, { extensionVersion: version, vscodeVersion: PINNED_VSCODE_VERSION, requestedModel: launch.run.model, now: new Date() });
  if (runFacts.dirty) console.log("[copilot-e2e] the working tree has changes: the release evidence will record that, and the release gate refuses it");
}

export const config: WebdriverIO.Config = {
  runner: "local",
  // Specs, one instance, the capability, the vscode service, and the
  // onWorkerStart (keep extensions) and onWorkerEnd (release the profile) hooks.
  ...launch.config,
  framework: "mocha",
  reporters: ["spec", [CopilotE2eResultsReporter, { evidenceDir }]],
  logLevel: "warn",
  // A real chat turn takes a while.
  mochaOpts: { ui: "tdd", timeout: 600_000 },
  outputDir: path.join(import.meta.dirname, "test/ui/out"),
  // Launcher only, after every worker has written its results.
  onComplete() {
    if (runFacts === undefined) return;
    try {
      const { results, log } = readRunArtifacts(evidenceDir);
      const evidence = buildEvidence(runFacts, results, log);
      recordEvidence({ git, writeFile: (file, text) => writeFileSync(file, text), log: (line) => console.log(line) }, evidence, path.join(rootDir, "evidence.json"));
    } catch (error) {
      console.error(`[copilot-e2e] couldn't record the release evidence: ${(error as Error).message}`);
      process.exitCode = 1;
    }
  },
};
