// Records the free demo scenes (docs/plans/docs-refresh-and-demo-recordings.md §5,
// task 1.3): VS Code on made-up data, no Copilot sign-in, into MP4 masters in
// demo-masters/ (AICA_DEMO_MASTERS overrides). `npm run build` first, then
//   npm run demo:record
// which runs this under an Xvfb screen of exactly the 1200x800 frame with
// WAYLAND_DISPLAY unset. Not part of `test:ui:vscode`, CI or `npm test`.
// TDD exception: wdio glue; the scenes assert their own end state, and what they
// call (scripts/demo/) is unit-tested.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { browser } from "@wdio/globals";
import { UI_FIXTURE_ENV } from "./test/ui/support/ui-fixture-env.mts";
import { assertWindowFillsFrame, readWindowBox, DEMO_USER_SETTINGS, DEMO_VSCODE_ARGS } from "./test/ui/demo/support/demo-launch.mts";
import { KEEP_EXTENSIONS_MARKER, KeepExtensionsLauncher } from "./scripts/ui-automation/keep-extensions-service.mts";
import { createUiFixture } from "./scripts/ui-automation/ui-fixture.mts";
import { PINNED_VSCODE_VERSION } from "./scripts/ui-automation/vscode-version.mts";

// wdio loads this file in the launcher and again in every worker; only the
// launcher seeds the fixture, and the workers read it from the environment.
const ROOT_ENV = "AICA_DEMO_ROOT";
const inWorker = process.env[ROOT_ENV] !== undefined;
// A short path: VS Code keeps IPC sockets under the user-data dir.
const rootDir = process.env[ROOT_ENV] ?? mkdtempSync(path.join(tmpdir(), "aica-demo-"));
if (!inWorker) {
  process.env[ROOT_ENV] = rootDir;
  process.on("exit", () => rmSync(rootDir, { recursive: true, force: true }));
}
const fixture = inWorker ? (JSON.parse(process.env[UI_FIXTURE_ENV] as string) as ReturnType<typeof createUiFixture>) : createUiFixture(rootDir);
process.env[UI_FIXTURE_ENV] = JSON.stringify(fixture);
// The Copilot CLI event log is read from COPILOT_HOME; the launcher's environment reaches VS Code.
process.env.COPILOT_HOME = fixture.copilotHome;

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./test/ui/demo/**/*.demo.ts"],
  maxInstances: 1,
  capabilities: [
    {
      browserName: "vscode",
      browserVersion: PINNED_VSCODE_VERSION,
      // Installed extensions load (no "All installed extensions are temporarily disabled" toast in the frame).
      [KEEP_EXTENSIONS_MARKER]: true,
      "wdio:vscodeOptions": {
        extensionPath: import.meta.dirname,
        storagePath: fixture.storagePath,
        userSettings: { ...fixture.userSettings, ...DEMO_USER_SETTINGS },
        verboseLogging: false,
        vscodeArgs: DEMO_VSCODE_ARGS,
      },
    } as WebdriverIO.Capabilities,
  ],
  services: [["vscode", { cachePath: path.join(import.meta.dirname, ".wdio-vscode-service") }]],
  // The vscode service has downloaded VS Code by now (its onPrepare is done).
  onWorkerStart: (_cid, capabilities) => {
    new KeepExtensionsLauncher({ dir: path.join(rootDir, "bin") }).prepare([capabilities as never]);
  },
  framework: "mocha",
  reporters: ["spec"],
  logLevel: "warn",
  mochaOpts: { ui: "tdd", timeout: 180_000 },
  outputDir: path.join(import.meta.dirname, "test/ui/out"),
  // A wrong Xvfb size must never record garbage.
  before: async () => {
    await assertWindowFillsFrame(() => browser.execute(readWindowBox));
  },
};
