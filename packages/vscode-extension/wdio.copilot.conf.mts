// The opt-in, owner-run suite that drives a REAL signed-in Copilot Chat
// (docs/plans/vscode-ui-automation.md §7): checks 1.4, 2.3 and 2.4 with a real
// agent-mode chat. It spends AI Credits, so it is not part of
// `npm run test:ui:vscode`, the extension-ui CI job or `npm test`, and it does
// nothing unless COPILOT_E2E=1 and COPILOT_E2E_USER_DATA_DIR point at the
// throwaway profile you signed in with (`npm run test:ui:vscode:copilot:signin`).
//
//   COPILOT_E2E=1 COPILOT_E2E_USER_DATA_DIR=~/.cache/aica-copilot-e2e/user-data \
//     npm run test:ui:vscode:copilot   (under a display, or xvfb-run -a)
//
// It runs VS Code on a COPY of that profile (profile-copy.mts: only `User` and
// `Local State`), deleted afterwards. It never reads, prints or stores the
// sign-in: VS Code finds it in the copied state.
//
// Release evidence (owner decision D1, docs/plans/release-ui-gate.md G2): when
// the run ends, onComplete writes its result as a git note on the commit it
// started on (refs/notes/release-ui), dirty tree and skips included, prints
// the release gate's verdict and the push command, and never pushes.
// TDD exception: the hooks below only run in a real wdio run; what they call
// (scripts/release-evidence/) is unit-tested.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { TEST_HOOKS_ENV } from "./src/diagnostics/test-hooks.ts";
import { readCopilotE2eEnv } from "./test/ui/copilot-e2e/support/copilot-e2e-env.mts";
import { copyProfile } from "./test/ui/copilot-e2e/support/profile-copy.mts";
import { COPILOT_E2E_SETTINGS, copilotE2eAgentFile } from "./test/ui/copilot-e2e/support/copilot-e2e-settings.mts";
import { copilotStateSeeds, seedProfileAgent, seedProfileState } from "./test/ui/copilot-e2e/support/profile-seed.mts";
import CopilotE2eResultsReporter from "./test/ui/copilot-e2e/support/results-reporter.mts";
import { COPILOT_E2E_ROOT_ENV as ROOT_ENV, evidenceDirOf } from "./test/ui/copilot-e2e/support/run-log.mts";
import { buildEvidence, type RunFacts } from "./scripts/release-evidence/build.mts";
import { nodeGit } from "./scripts/release-evidence/git-notes.mts";
import { readRunFacts, recordEvidence } from "./scripts/release-evidence/record.mts";
import { readRunArtifacts } from "./scripts/release-evidence/run-artifacts.mts";
import { COPILOT_E2E_VSCODE_ARGS } from "./scripts/ui-automation/copilot-vscode-args.mts";
import { KEEP_EXTENSIONS_MARKER, KeepExtensionsLauncher } from "./scripts/ui-automation/keep-extensions-service.mts";
import { PINNED_VSCODE_VERSION } from "./scripts/ui-automation/vscode-version.mts";
import { installWorkbenchBridge, normalModeVscodeArgs, wdioProxyModule } from "./scripts/ui-automation/workbench-bridge.mts";

// The analyzer's test hooks in a Development-mode extension host (owner
// decision D5); VS Code and its extension host inherit this process's environment.
process.env[TEST_HOOKS_ENV] = "1";

// wdio loads this file in the launcher and again in every worker; only the
// launcher copies the profile and reports the skip.
const env = readCopilotE2eEnv(process.env);
if (env.status === "skip") {
  if (process.env[ROOT_ENV] === undefined) console.log(`[copilot-e2e] SKIPPED: ${env.reason}`);
  // A skip is not a failure: exit 0 before wdio starts anything.
  process.exit(0);
}

const inWorker = process.env[ROOT_ENV] !== undefined;
const rootDir = process.env[ROOT_ENV] ?? mkdtempSync(path.join(tmpdir(), "aica-copilot-e2e-"));
const storagePath = path.join(rootDir, "storage");
// An empty folder to open: in an empty window Copilot Chat writes its debug
// logs to User/globalStorage, where the analyzer doesn't look (G3).
const workspacePath = path.join(rootDir, "workspace");
const evidenceDir = evidenceDirOf(rootDir);
const git = nodeGit(import.meta.dirname);
// Taken when the run starts, so a commit made during the run isn't credited with it.
let runFacts: RunFacts | undefined;
if (!inWorker) {
  process.env[ROOT_ENV] = rootDir;
  process.env.AI_CREDITS_ANALYZER_COPILOT_E2E_MODEL = env.model;
  process.on("exit", () => rmSync(rootDir, { recursive: true, force: true }));
  mkdirSync(path.join(storagePath, "settings"), { recursive: true });
  mkdirSync(workspacePath, { recursive: true });
  copyProfile(env.userDataDir, path.join(storagePath, "settings"));
  // In the copy only: pick the requested model (nothing in normal mode picks
  // it for us) and add the agent whose only tools are the analyzer's (D6).
  seedProfileState(path.join(storagePath, "settings"), copilotStateSeeds(env.model));
  seedProfileAgent(path.join(storagePath, "settings"), copilotE2eAgentFile());
  // Normal mode (G3): executeWorkbench is served by a bridge extension, not
  // the service's test runner, so VS Code reads the copy's storage and sign-in.
  installWorkbenchBridge({ extensionsDir: path.join(storagePath, "extensions"), proxyModule: wdioProxyModule() });
  console.log(`[copilot-e2e] running on a copy of ${env.userDataDir} (User and Local State only), expecting model ${env.model}; the copy is deleted afterwards`);
  const { version } = JSON.parse(readFileSync(path.join(import.meta.dirname, "package.json"), "utf-8")) as { version: string };
  runFacts = readRunFacts(git, { extensionVersion: version, vscodeVersion: PINNED_VSCODE_VERSION, requestedModel: env.model, now: new Date() });
  if (runFacts.dirty) console.log("[copilot-e2e] the working tree has changes: the release evidence will record that, and the release gate refuses it");
}

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./test/ui/copilot-e2e/specs/**/*.e2e.ts"],
  maxInstances: 1,
  capabilities: [
    {
      browserName: "vscode",
      browserVersion: PINNED_VSCODE_VERSION,
      // The service starts VS Code with --disable-extensions; Copilot Chat must load.
      [KEEP_EXTENSIONS_MARKER]: true,
      "wdio:vscodeOptions": {
        extensionPath: import.meta.dirname,
        storagePath,
        workspacePath,
        userSettings: COPILOT_E2E_SETTINGS,
        verboseLogging: false,
        // --password-store=basic, as the sign-in script used: without it VS Code
        // uses the OS keyring and can't decrypt the copied sign-in. And no
        // --extensionTestsPath: with one, VS Code keeps application storage and
        // secrets in memory and never sees the copied sign-in (G3); and shared
        // storage in the run, not in ~/.vscode-shared.
        vscodeArgs: { ...COPILOT_E2E_VSCODE_ARGS, ...normalModeVscodeArgs(storagePath) },
      },
    } as WebdriverIO.Capabilities,
  ],
  services: [["vscode", { cachePath: path.join(import.meta.dirname, ".wdio-vscode-service") }]],
  // The vscode service has downloaded VS Code and set `binary` by now.
  onWorkerStart: (_cid, capabilities) => {
    new KeepExtensionsLauncher({ dir: path.join(rootDir, "bin") }).prepare([capabilities as never]);
  },
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
