// WebdriverIO's configuration for the VS Code UI automation (step 10.16,
// docs/plans/vscode-ui-automation.md): the manual checks that need a real
// workbench and webview, run with wdio-vscode-service. `npm run build`
// first, then `xvfb-run -a -s "-screen 0 1600x1000x24" npm run test:ui:vscode`.
// It seeds throwaway VS Code user-data dirs (ui-fixture.mts) before VS Code
// starts, and tells the specs about the main one through the environment.
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { OUT_DIR, saveScreenshot } from "./test/ui/support/screenshots.ts";
import { COPILOT_FIXTURE_ENV, FIRST_RUN_FIXTURE_ENV, S9_FIXTURE_ENV, TRUST_FIXTURE_ENV, UI_FIXTURE_ENV, UNINSTALL_FIXTURE_ENV } from "./test/ui/support/ui-fixture-env.mts";
import { PINNED_VSCODE_VERSION } from "./scripts/ui-automation/vscode-version.mts";
import { buildVsix } from "./scripts/ui-automation/build-vsix.mts";
import { cliOf, installVsix } from "./scripts/ui-automation/install-vsix.mts";
import { KEEP_EXTENSIONS_MARKER, KeepExtensionsLauncher } from "./scripts/ui-automation/keep-extensions-service.mts";
import { createFirstRunFixture, createUiFixture } from "./scripts/ui-automation/ui-fixture.mts";
import { createS9Fixture } from "./scripts/ui-automation/s9-fixture.mts";

export { PINNED_VSCODE_VERSION };

// The spec that needs Workspace Trust on and a workspace folder (check 2.5);
// it gets its own VS Code launch, and every other spec runs in the main one.
const TRUST_SPEC = "./test/ui/specs/mcp-trust.e2e.ts";

// Checks 1.1-1.3: a VS Code that has never seen Copilot Chat or the extension.
const FIRST_RUN_SPEC = "./test/ui/specs/first-run.e2e.ts";
// Checks 1.2 and 1.4: sessions from the fixture and the Copilot Chat that
// ships built in to VS Code, enabled (it is off in a fresh profile) but never
// signed in, so the analyzer sees an installed Copilot Chat with its real settings.
const COPILOT_SPEC = "./test/ui/specs/copilot-available.e2e.ts";
// Check 1.12: two launches on one profile, the analyzer installed, then gone.
const UNINSTALL_INSTALLED_SPEC = "./test/ui/specs/uninstall-installed.e2e.ts";
const UNINSTALL_AFTER_SPEC = "./test/ui/specs/uninstall-after.e2e.ts";
// Scenario S9 (Phase 15 step 15.14): a workspace folder that is a git
// repository, so the status bar names it.
const S9_SPEC = "./test/ui/specs/s9-group-by-repository.e2e.ts";
const OWN_LAUNCH_SPECS = [TRUST_SPEC, FIRST_RUN_SPEC, COPILOT_SPEC, UNINSTALL_INSTALLED_SPEC, UNINSTALL_AFTER_SPEC, S9_SPEC];

// wdio loads this file in the launcher and again in every worker. Only the
// launcher seeds the fixtures: its root and fixtures reach the workers (and so
// the specs) through the environment, so a spec reads the very directories VS
// Code was started on. (A worker that seeded its own would point the specs at
// copies nothing uses.)
const ROOT_ENV = "AI_CREDITS_ANALYZER_UI_ROOT";
const inWorker = process.env[ROOT_ENV] !== undefined;
// A short path: VS Code keeps IPC sockets under the user-data dir.
const rootDir = process.env[ROOT_ENV] ?? mkdtempSync(path.join(tmpdir(), "aica-ui-"));
if (!inWorker) {
  process.env[ROOT_ENV] = rootDir;
  process.on("exit", () => rmSync(rootDir, { recursive: true, force: true }));
}
function seeded<T>(envName: string, create: () => T): T {
  if (inWorker) return JSON.parse(process.env[envName] as string) as T;
  const value = create();
  process.env[envName] = JSON.stringify(value);
  return value;
}
const fixture = seeded(UI_FIXTURE_ENV, () => createUiFixture(rootDir));
const firstRunFixture = seeded(FIRST_RUN_FIXTURE_ENV, () => createFirstRunFixture(path.join(rootDir, "first-run")));
const copilotFixture = seeded(COPILOT_FIXTURE_ENV, () => createUiFixture(path.join(rootDir, "copilot"), { sessionCount: 3 }));
const uninstallFixture = seeded(UNINSTALL_FIXTURE_ENV, () => {
  const created = createFirstRunFixture(path.join(rootDir, "uninstall"));
  // What a user who followed a Fix button has set by hand (check 1.12 expects it to survive).
  created.userSettings["github.copilot.chat.agentDebugLog.fileLogging.enabled"] = true;
  return created;
});
// Check 2.5: a folder whose own settings turn the MCP server on, opened with
// Workspace Trust enabled (the service disables it by default, F8), so VS Code
// starts it in Restricted Mode.
const trustFixture = seeded(TRUST_FIXTURE_ENV, () => createUiFixture(path.join(rootDir, "trust"), { sessionCount: 1 }));
const s9Fixture = seeded(S9_FIXTURE_ENV, () => createS9Fixture(path.join(rootDir, "s9")));
const trustWorkspace = path.join(rootDir, "trust-workspace");
if (!inWorker) {
  mkdirSync(path.join(trustWorkspace, ".vscode"), { recursive: true });
  writeFileSync(path.join(trustWorkspace, ".vscode", "settings.json"), `${JSON.stringify({ "aiCreditsAnalyzer.mcp.enabled": true }, null, 2)}\n`);
}
// The Copilot CLI event log is read from COPILOT_HOME (F5); the launcher's
// environment reaches chromedriver and so VS Code.
process.env.COPILOT_HOME = fixture.copilotHome;

// Under xvfb there is no window manager, so Chromium may treat the window as
// occluded and stop producing frames.
const CHROMIUM_FLAGS = {
  "disable-renderer-backgrounding": true,
  "disable-backgrounding-occluded-windows": true,
  "disable-features": "CalculateNativeWinOcclusion",
};

// One entry per VS Code launch. AICA_UI_LAUNCH=first-run,copilot runs only
// those (a development aid: the full suite runs them all).
const LAUNCHES: Record<string, object> = {
  main: {
    browserName: "vscode",
    browserVersion: PINNED_VSCODE_VERSION,
    "wdio:vscodeOptions": {
      extensionPath: import.meta.dirname,
      storagePath: fixture.storagePath,
      userSettings: fixture.userSettings,
      verboseLogging: false,
      vscodeArgs: CHROMIUM_FLAGS,
    },
    // wdio reads per-capability spec lists; its capability type doesn't declare them.
    exclude: OWN_LAUNCH_SPECS,
  },
  "first-run": {
    browserName: "vscode",
    browserVersion: PINNED_VSCODE_VERSION,
    "wdio:vscodeOptions": {
      extensionPath: import.meta.dirname,
      storagePath: firstRunFixture.storagePath,
      userSettings: firstRunFixture.userSettings,
      verboseLogging: false,
      vscodeArgs: CHROMIUM_FLAGS,
    },
    specs: [FIRST_RUN_SPEC],
  },
  copilot: {
    browserName: "vscode",
    browserVersion: PINNED_VSCODE_VERSION,
    "wdio:vscodeOptions": {
      extensionPath: import.meta.dirname,
      storagePath: copilotFixture.storagePath,
      userSettings: copilotFixture.userSettings,
      verboseLogging: false,
      vscodeArgs: CHROMIUM_FLAGS,
    },
    specs: [COPILOT_SPEC],
  },
  trust: {
    browserName: "vscode",
    browserVersion: PINNED_VSCODE_VERSION,
    "wdio:vscodeOptions": {
      extensionPath: import.meta.dirname,
      storagePath: trustFixture.storagePath,
      userSettings: { ...trustFixture.userSettings, "security.workspace.trust.enabled": true, "security.workspace.trust.startupPrompt": "never" },
      workspacePath: trustWorkspace,
      verboseLogging: false,
      vscodeArgs: { ...CHROMIUM_FLAGS, disableWorkspaceTrust: false },
    },
    specs: [TRUST_SPEC],
  },
  // Scenario S9 (plan §12.4.2): Copilot sessions in two repositories,
  // portal-web open as the workspace folder.
  s9: {
    browserName: "vscode",
    browserVersion: PINNED_VSCODE_VERSION,
    "wdio:vscodeOptions": {
      extensionPath: import.meta.dirname,
      storagePath: s9Fixture.storagePath,
      userSettings: s9Fixture.userSettings,
      workspacePath: s9Fixture.workspacePath,
      verboseLogging: false,
      vscodeArgs: CHROMIUM_FLAGS,
    },
    specs: [S9_SPEC],
  },
  // Check 1.12: the analyzer installed from its VSIX (not under development:
  // the development extension is an empty stand-in), then uninstalled, then a
  // second launch on the same profile. The wrapper lets installed extensions load.
  uninstall: {
    browserName: "vscode",
    browserVersion: PINNED_VSCODE_VERSION,
    "wdio:vscodeOptions": {
      extensionPath: path.join(import.meta.dirname, "test/ui/fixtures/empty-extension"),
      storagePath: uninstallFixture.storagePath,
      userSettings: uninstallFixture.userSettings,
      verboseLogging: false,
      vscodeArgs: CHROMIUM_FLAGS,
    },
    [KEEP_EXTENSIONS_MARKER]: true,
    specs: [UNINSTALL_INSTALLED_SPEC, UNINSTALL_AFTER_SPEC],
  },
};
const onlyLaunches = process.env.AICA_UI_LAUNCH?.split(",").map((name) => name.trim());

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./test/ui/specs/**/*.e2e.ts"],
  maxInstances: 1,
  capabilities: Object.entries(LAUNCHES)
    .filter(([name]) => onlyLaunches === undefined || onlyLaunches.includes(name))
    .map(([, capability]) => capability as WebdriverIO.Capabilities),
  services: [["vscode", { cachePath: path.join(import.meta.dirname, ".wdio-vscode-service") }]],
  // The vscode service has downloaded VS Code by now (its onPrepare is done).
  onWorkerStart: (_cid, capabilities, specs) => {
    const options = (capabilities as { "wdio:vscodeOptions"?: { binary?: string; storagePath?: string } })["wdio:vscodeOptions"];
    // Check 1.12: the first spec's launch starts with the analyzer installed
    // from the VSIX; the second launch must find it gone, so it is not reinstalled.
    if ((specs as string[]).some((spec) => spec.endsWith("uninstall-installed.e2e.ts")) && options?.binary && options.storagePath) {
      installVsix({
        cli: cliOf(options.binary),
        vsix: buildVsix(path.join(rootDir, "ai-credits-analyzer.vsix")),
        extensionsDir: path.join(options.storagePath, "extensions"),
        userDataDir: path.join(options.storagePath, "settings"),
      });
    }
    new KeepExtensionsLauncher({ dir: path.join(rootDir, "bin") }).prepare([capabilities as never]);
  },
  framework: "mocha",
  reporters: ["spec"],
  logLevel: "warn",
  mochaOpts: { ui: "tdd", timeout: 120_000 },
  outputDir: path.join(import.meta.dirname, "test/ui/out"),
  // For every failing test, in test/ui/out/ (CI uploads it): a screenshot of
  // the window, and VS Code's logs (the extension host's console included).
  afterTest: async (test, _context, { passed }) => {
    if (passed) return;
    const name = `failure-${test.title}`.replace(/[^a-zA-Z0-9.-]+/g, "_").slice(0, 120);
    await saveScreenshot(name).catch(() => undefined);
    for (const [label, { userDataDir }] of [["main", fixture], ["trust", trustFixture], ["first-run", firstRunFixture], ["copilot", copilotFixture], ["uninstall", uninstallFixture], ["s9", s9Fixture]] as const) {
      if (existsSync(path.join(userDataDir, "logs"))) cpSync(path.join(userDataDir, "logs"), path.join(OUT_DIR, `${name}-logs-${label}`), { recursive: true, force: true });
    }
  },
};
