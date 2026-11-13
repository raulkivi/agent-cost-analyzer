// Records the free demo scenes (docs/plans/docs-refresh-and-demo-recordings.md §5,
// tasks 1.3 and 1.6a): VS Code on made-up data, no Copilot sign-in, into MP4 masters in
// demo-masters/ (AICA_DEMO_MASTERS overrides). `npm run build` first, then
//   npm run demo:record
// which runs this under an Xvfb screen of exactly the 1200x800 frame with
// WAYLAND_DISPLAY unset. Not part of `test:ui:vscode`, CI or `npm test`.
//
// Two launches, each on its own fixture (scripts/ui-automation/demo-fixture.mts):
//   ready          every scene but E1: Copilot Chat enabled, debug logging on, nothing for Setup to flag.
//   setup-problem  scenes named e1-*.demo.ts: Copilot Chat enabled, debug logging unset, so Setup flags it.
// Both enable the Copilot Chat built in to VS Code (off in a new profile) once the workbench
// is up: without it the analyzer says "GitHub Copilot Chat is disabled or not installed" in the
// panel and "setup needed" in the status bar, whatever the settings hold.
//
// TDD exception: wdio glue; the scenes assert their own end state, and what they call
// (scripts/demo/, scripts/ui-automation/demo-fixture.mts) is unit-tested.
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { browser } from "@wdio/globals";
import { assertWindowFillsFrame, readWindowBox, DEMO_USER_SETTINGS, DEMO_VSCODE_ARGS } from "./test/ui/demo/support/demo-launch.mts";
import { KEEP_EXTENSIONS_MARKER, KeepExtensionsLauncher } from "./scripts/ui-automation/keep-extensions-service.mts";
import {
  createDemoFixture,
  DEMO_FIXTURE_ENV,
  DEMO_SETUP_PROBLEM_FIXTURE_ENV,
  demoVariantOfSpec,
  parseDemoFixture,
  type DemoFixture,
  type DemoVariant,
} from "./scripts/ui-automation/demo-fixture.mts";
import { PINNED_VSCODE_VERSION } from "./scripts/ui-automation/vscode-version.mts";

// wdio loads this file in the launcher and again in every worker; only the
// launcher seeds the fixtures, and the workers read them from the environment.
const ROOT_ENV = "AICA_DEMO_ROOT";
const inWorker = process.env[ROOT_ENV] !== undefined;
// A short path: VS Code keeps IPC sockets under the user-data dir.
const rootDir = process.env[ROOT_ENV] ?? mkdtempSync(path.join(tmpdir(), "aica-demo-"));
if (!inWorker) {
  process.env[ROOT_ENV] = rootDir;
  process.on("exit", () => rmSync(rootDir, { recursive: true, force: true }));
}
// One instant for both fixtures, so their sessions and billing periods agree.
const RUN_NOW = new Date();
function seeded(envName: string, variant: DemoVariant): DemoFixture {
  if (inWorker) return parseDemoFixture(process.env[envName], envName);
  const created = createDemoFixture(path.join(rootDir, variant), { variant, now: RUN_NOW });
  process.env[envName] = JSON.stringify(created);
  return created;
}
const readyFixture = seeded(DEMO_FIXTURE_ENV, "ready");
const problemFixture = seeded(DEMO_SETUP_PROBLEM_FIXTURE_ENV, "setup-problem");
// The Copilot CLI event log is read from COPILOT_HOME; the launcher's environment reaches VS Code.
// Per launch, so a worker sets its own below.
process.env.COPILOT_HOME = readyFixture.copilotHome;

const DEMO_DIR = "./test/ui/demo";
const scenes = readdirSync(path.join(import.meta.dirname, DEMO_DIR)).filter((name) => name.endsWith(".demo.ts"));
const specsOf = (variant: DemoVariant): string[] => scenes.filter((name) => demoVariantOfSpec(name) === variant).map((name) => `${DEMO_DIR}/${name}`);

function launch(fixture: DemoFixture): object {
  return {
    browserName: "vscode",
    browserVersion: PINNED_VSCODE_VERSION,
    // Installed extensions load (no "All installed extensions are temporarily disabled" toast in the frame).
    [KEEP_EXTENSIONS_MARKER]: true,
    "wdio:vscodeOptions": {
      extensionPath: import.meta.dirname,
      storagePath: fixture.storagePath,
      // The workspace folder is a git repository with a made-up remote, so the status bar names it.
      workspacePath: fixture.workspacePath,
      userSettings: { ...fixture.userSettings, ...DEMO_USER_SETTINGS },
      verboseLogging: false,
      vscodeArgs: DEMO_VSCODE_ARGS,
    },
    // wdio reads per-capability spec lists; its capability type doesn't declare them.
    specs: specsOf(fixture.variant),
  };
}

// A launch with no scene (no e1-*.demo.ts yet) is left out: wdio fails a capability that has no specs.
const capabilities = [readyFixture, problemFixture].filter((fixture) => specsOf(fixture.variant).length > 0).map(launch);

// The launch a worker serves, from the fixture its VS Code was given.
const fixtureOf = (storagePath: string | undefined): DemoFixture => (storagePath === problemFixture.storagePath ? problemFixture : readyFixture);

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: [`${DEMO_DIR}/**/*.demo.ts`],
  maxInstances: 1,
  capabilities: capabilities as WebdriverIO.Capabilities[],
  services: [["vscode", { cachePath: path.join(import.meta.dirname, ".wdio-vscode-service") }]],
  // The vscode service has downloaded VS Code by now (its onPrepare is done).
  onWorkerStart: (_cid, capability) => {
    const options = (capability as { "wdio:vscodeOptions"?: { storagePath?: string } })["wdio:vscodeOptions"];
    process.env.COPILOT_HOME = fixtureOf(options?.storagePath).copilotHome;
    new KeepExtensionsLauncher({ dir: path.join(rootDir, "bin") }).prepare([capability as never]);
  },
  framework: "mocha",
  reporters: ["spec"],
  logLevel: "warn",
  mochaOpts: { ui: "tdd", timeout: 180_000 },
  outputDir: path.join(import.meta.dirname, "test/ui/out"),
  before: async () => {
    // A wrong Xvfb size must never record garbage.
    await assertWindowFillsFrame(() => browser.execute(readWindowBox));
    await enableCopilotChat();
  },
};

// Copilot Chat ships built in to VS Code but is off in a new profile (the release suite's
// copilot-available spec enables it the same way, without signing in). The analyzer then
// finds it installed and re-runs its setup checks.
async function enableCopilotChat(): Promise<void> {
  const copilotChatListed = (): Promise<boolean> =>
    browser.executeWorkbench((vscode) => vscode.extensions.getExtension("GitHub.copilot-chat") !== undefined).catch(() => false);
  await browser.waitUntil(async () => {
    try {
      await browser.executeWorkbench((vscode) => vscode.commands.executeCommand("workbench.extensions.action.enableAll"));
      return true;
    } catch {
      return false;
    }
  }, { timeout: 60_000, interval: 500, timeoutMsg: "the workbench never answered the enable-all-extensions command" });
  await browser.waitUntil(copilotChatListed, { timeout: 90_000, interval: 500, timeoutMsg: "Copilot Chat is not enabled in the demo's VS Code" });
}
