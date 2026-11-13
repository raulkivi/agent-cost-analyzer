// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// How a wdio config launches VS Code on a copy of the signed-in Copilot
// profile in normal mode (docs/plans/vscode-ui-automation.md §7,
// docs/plans/release-ui-gate.md G3): the real-Copilot release suite
// (wdio.copilot.conf.mts) and the real-Copilot demo recordings share it
// (docs/plans/docs-refresh-and-demo-recordings.md task 1.2). The release
// evidence (results reporter, git note) stays in wdio.copilot.conf.mts.
//
// wdio loads a config in the launcher and again in every worker. Only the
// launcher prepares the run: it makes a fresh root, copies the profile there
// (profile-copy.mts: only `User` and `Local State`) and seeds the copy, and
// passes the root to the workers in an environment variable, whose presence
// marks a worker. The copy is deleted when the launcher exits. It never
// reads, prints or stores the sign-in: VS Code finds it in the copied state.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { TEST_HOOKS_ENV } from "../../../../src/diagnostics/test-hooks.ts";
import { COPILOT_E2E_VSCODE_ARGS } from "../../../../scripts/ui-automation/copilot-vscode-args.mts";
import { createGitFolder, E2E_REMOTE } from "../../../../scripts/ui-automation/git-folder.mts";
import { KEEP_EXTENSIONS_MARKER, KeepExtensionsLauncher } from "../../../../scripts/ui-automation/keep-extensions-service.mts";
import { nodeReleaseDeps, releaseProfile } from "../../../../scripts/ui-automation/profile-release.mts";
import { PINNED_VSCODE_VERSION } from "../../../../scripts/ui-automation/vscode-version.mts";
import { installWorkbenchBridge, normalModeVscodeArgs, wdioProxyModule } from "../../../../scripts/ui-automation/workbench-bridge.mts";
import { CHAT_HISTORY_ENV, clearChatHistory, seedChatHistory } from "./chat-history-seed.mts";
import { readCopilotE2eEnv } from "./copilot-e2e-env.mts";
import { COPILOT_E2E_SETTINGS, copilotE2eAgentFile } from "./copilot-e2e-settings.mts";
import { MAX_AI_CREDITS_INTERNAL_ENV } from "./credit-budget.mts";
import { copyProfile } from "./profile-copy.mts";
import { copilotStateSeeds, seedProfileAgent, seedProfileState } from "./profile-seed.mts";
import { COPILOT_E2E_ROOT_ENV } from "./run-log.mts";

// packages/vscode-extension: the extension under test, and where the configs live.
export const PACKAGE_DIR = path.resolve(import.meta.dirname, "../../../..");
// Relative to the config, which sits in PACKAGE_DIR.
export const COPILOT_E2E_SPECS = ["./test/ui/copilot-e2e/specs/**/*.e2e.ts"];
export const COPILOT_E2E_TMP_PREFIX = "aica-copilot-e2e-";
// The model the specs expect (copilot-chat.ts reads it).
const MODEL_ENV = "AI_CREDITS_ANALYZER_COPILOT_E2E_MODEL";

export interface CopilotLaunchPaths {
  rootDir: string;
  storagePath: string;
  // The profile copy: VS Code's user-data dir.
  settingsDir: string;
  extensionsDir: string;
  // A git folder with a made-up remote (check 1.14) to open: in an empty
  // window Copilot Chat writes its debug logs to User/globalStorage, where
  // the analyzer doesn't look (G3).
  workspacePath: string;
  reposDir: string;
  copilotHome: string;
  binDir: string;
}

export function copilotLaunchPaths(rootDir: string): CopilotLaunchPaths {
  const storagePath = path.join(rootDir, "storage");
  return {
    rootDir,
    storagePath,
    settingsDir: path.join(storagePath, "settings"),
    extensionsDir: path.join(storagePath, "extensions"),
    workspacePath: path.join(rootDir, "workspace"),
    reposDir: path.join(rootDir, "repos"),
    copilotHome: path.join(rootDir, "copilot-home"),
    binDir: path.join(rootDir, "bin"),
  };
}

export function copilotUserSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...COPILOT_E2E_SETTINGS, ...overrides };
}

// --password-store=basic, as the sign-in script used: without it VS Code uses
// the OS keyring and can't decrypt the copied sign-in. And no
// --extensionTestsPath: with one, VS Code keeps application storage and
// secrets in memory and never sees the copied sign-in (G3); and shared
// storage in the run, not in ~/.vscode-shared.
export function copilotLaunchVscodeArgs(storagePath: string): Record<string, string | boolean> {
  return { ...COPILOT_E2E_VSCODE_ARGS, ...normalModeVscodeArgs(storagePath) };
}

export interface CopilotCapabilityInput {
  extensionPath: string;
  storagePath: string;
  workspacePath: string;
  userSettings: Record<string, unknown>;
}

export function copilotCapability({ extensionPath, storagePath, workspacePath, userSettings }: CopilotCapabilityInput): WebdriverIO.Capabilities {
  return {
    browserName: "vscode",
    browserVersion: PINNED_VSCODE_VERSION,
    // The service starts VS Code with --disable-extensions; Copilot Chat must load.
    [KEEP_EXTENSIONS_MARKER]: true,
    "wdio:vscodeOptions": {
      extensionPath,
      storagePath,
      workspacePath,
      userSettings,
      verboseLogging: false,
      vscodeArgs: copilotLaunchVscodeArgs(storagePath),
    },
  } as WebdriverIO.Capabilities;
}

export interface LauncherEnvInput {
  rootEnv: string;
  rootDir: string;
  model: string;
  maxAiCredits: number;
  copilotHome: string;
}

// What the launcher hands its workers and the VS Code they start.
export function launcherEnv({ rootEnv, rootDir, model, maxAiCredits, copilotHome }: LauncherEnvInput): Record<string, string> {
  return {
    [rootEnv]: rootDir,
    [MODEL_ENV]: model,
    [MAX_AI_CREDITS_INTERNAL_ENV]: String(maxAiCredits),
    // An empty Copilot CLI home: the analyzer reads none of the owner's Copilot
    // CLI sessions, and Copilot Chat writes its own logs into the run.
    COPILOT_HOME: copilotHome,
  };
}

export interface CopilotLaunchOptions {
  // Default COPILOT_E2E_SPECS.
  specs?: string[];
  // Merged on top of COPILOT_E2E_SETTINGS.
  userSettings?: Record<string, unknown>;
  // The variable that carries the root from the launcher to its workers.
  // Default COPILOT_E2E_ROOT_ENV.
  rootEnv?: string;
  // The made-up chat history (G4) the view specs read. Default true. The
  // copy's own chats are cleared either way.
  seedChatHistory?: boolean;
  // Default COPILOT_E2E_TMP_PREFIX.
  tmpPrefix?: string;
}

export interface CopilotLaunchDeps {
  // VS Code and its extension host inherit what is set here.
  env: Record<string, string | undefined>;
  log(line: string): void;
  exit(code: number): never;
  onExit(cleanup: () => void): void;
  now(): Date;
}

export const nodeLaunchDeps: CopilotLaunchDeps = {
  env: process.env,
  log: (line) => console.log(line),
  exit: (code) => process.exit(code),
  onExit: (cleanup) => process.on("exit", cleanup),
  now: () => new Date(),
};

export interface CopilotLaunch {
  run: { userDataDir: string; model: string; maxAiCredits: number };
  inWorker: boolean;
  paths: CopilotLaunchPaths;
  // Spread into the wdio config; it adds its framework, reporters and hooks.
  config: Required<Pick<WebdriverIO.Config, "specs" | "maxInstances" | "capabilities" | "services" | "onWorkerStart" | "onWorkerEnd">>;
}

// Exits 0 with the reason (printed by the launcher only) when the run isn't
// opted in (copilot-e2e-env.mts): a skip is not a failure, and wdio starts nothing.
export function prepareCopilotLaunch(options: CopilotLaunchOptions = {}, deps: CopilotLaunchDeps = nodeLaunchDeps): CopilotLaunch {
  const rootEnv = options.rootEnv ?? COPILOT_E2E_ROOT_ENV;
  // The analyzer's test hooks in a Development-mode extension host (owner decision D5).
  deps.env[TEST_HOOKS_ENV] = "1";
  const env = readCopilotE2eEnv(deps.env);
  const inWorker = deps.env[rootEnv] !== undefined;
  if (env.status === "skip") {
    if (!inWorker) deps.log(`[copilot-e2e] SKIPPED: ${env.reason}`);
    deps.exit(0);
  }
  const run = { userDataDir: env.userDataDir, model: env.model, maxAiCredits: env.maxAiCredits };
  const paths = copilotLaunchPaths(deps.env[rootEnv] ?? mkdtempSync(path.join(tmpdir(), options.tmpPrefix ?? COPILOT_E2E_TMP_PREFIX)));
  if (!inWorker) prepareRun(paths, run, { rootEnv, seedChatHistory: options.seedChatHistory ?? true }, deps);

  const capability = copilotCapability({
    extensionPath: PACKAGE_DIR,
    storagePath: paths.storagePath,
    workspacePath: paths.workspacePath,
    userSettings: copilotUserSettings(options.userSettings),
  });
  return {
    run,
    inWorker,
    paths,
    config: {
      specs: options.specs ?? COPILOT_E2E_SPECS,
      // One profile copy: one VS Code at a time.
      maxInstances: 1,
      capabilities: [capability],
      services: [["vscode", { cachePath: path.join(PACKAGE_DIR, ".wdio-vscode-service") }]],
      // The vscode service has downloaded VS Code and set `binary` by now.
      onWorkerStart: (_cid, capabilities) => {
        new KeepExtensionsLauncher({ dir: paths.binDir }).prepare([capabilities as never]);
      },
      // Awaited by the launcher before it starts the next spec file, whose VS
      // Code needs the profile copy to itself (profile-release.mts; the 1.146
      // release run's "Chrome instance exited").
      onWorkerEnd: async (cid) => {
        const { released, waitedMs, terminated, killed } = await releaseProfile(paths.settingsDir, nodeReleaseDeps((line) => deps.log(`[copilot-e2e] ${line}`)));
        if (waitedMs >= 1_000 || terminated.length > 0 || !released) {
          deps.log(`[copilot-e2e] after worker ${cid}: profile ${released ? "released" : "STILL HELD"} after ${(waitedMs / 1000).toFixed(1)} s (terminated ${terminated.length}, killed ${killed.length})`);
        }
      },
    },
  };
}

// Launcher only. TDD exception as before: the steps it calls are unit-tested,
// and copilot-launch.test.ts runs it on a made-up profile.
function prepareRun(paths: CopilotLaunchPaths, run: CopilotLaunch["run"], o: { rootEnv: string; seedChatHistory: boolean }, deps: CopilotLaunchDeps): void {
  Object.assign(deps.env, launcherEnv({ rootEnv: o.rootEnv, rootDir: paths.rootDir, model: run.model, maxAiCredits: run.maxAiCredits, copilotHome: paths.copilotHome }));
  deps.onExit(() => rmSync(paths.rootDir, { recursive: true, force: true }));
  mkdirSync(paths.settingsDir, { recursive: true });
  createGitFolder(paths.workspacePath, E2E_REMOTE);
  copyProfile(run.userDataDir, paths.settingsDir);
  // In the copy only: pick the requested model (nothing in normal mode picks
  // it for us) and add the agent whose only tools are the analyzer's (D6).
  seedProfileState(paths.settingsDir, copilotStateSeeds(run.model));
  seedProfileAgent(paths.settingsDir, copilotE2eAgentFile());
  // G4: the copy's earlier chats out, so no view shows the owner's chats;
  // then, unless the caller opts out, made-up sessions in two repositories
  // over several weeks for the MCP App view specs, which the workers read
  // from the env.
  clearChatHistory(paths.settingsDir);
  if (o.seedChatHistory) {
    const history = seedChatHistory({ userDataDir: paths.settingsDir, reposDir: paths.reposDir, now: deps.now() });
    deps.env[CHAT_HISTORY_ENV] = JSON.stringify(history);
  }
  mkdirSync(paths.copilotHome, { recursive: true });
  // Normal mode (G3): executeWorkbench is served by a bridge extension, not
  // the service's test runner, so VS Code reads the copy's storage and sign-in.
  installWorkbenchBridge({ extensionsDir: paths.extensionsDir, proxyModule: wdioProxyModule() });
  deps.log(
    `[copilot-e2e] running on a copy of ${run.userDataDir} (User and Local State only), expecting model ${run.model}, at most ${run.maxAiCredits} AI Credits (COPILOT_E2E_MAX_AI_CREDITS); the copy is deleted afterwards`,
  );
}
