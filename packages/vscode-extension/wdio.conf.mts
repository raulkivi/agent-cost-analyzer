// WebdriverIO's configuration for the VS Code UI automation (step 10.16,
// docs/plans/vscode-ui-automation.md): the manual checks that need a real
// workbench and webview, run with wdio-vscode-service. `npm run build`
// first, then `xvfb-run -a -s "-screen 0 1600x1000x24" npm run test:ui:vscode`.
// It seeds a throwaway VS Code user-data dir (ui-fixture.mts) before VS Code
// starts, and tells the specs about it through the environment.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { UI_FIXTURE_ENV } from "./test/ui/support/ui-fixture-env.mts";
import { createUiFixture } from "./scripts/ui-automation/ui-fixture.mts";

// Pinned (F9): page-object locators fall back to the 1.123 set for any
// newer stable, and patch releases can 404 on chromedriver (issue #157).
export const PINNED_VSCODE_VERSION = "1.145.0";

// A short path: VS Code keeps IPC sockets under the user-data dir.
const rootDir = mkdtempSync(path.join(tmpdir(), "aica-ui-"));
process.on("exit", () => rmSync(rootDir, { recursive: true, force: true }));
const fixture = createUiFixture(rootDir);
process.env[UI_FIXTURE_ENV] = JSON.stringify(fixture);
// The Copilot CLI event log is read from COPILOT_HOME (F5); the launcher's
// environment reaches chromedriver and so VS Code.
process.env.COPILOT_HOME = fixture.copilotHome;

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./test/ui/specs/**/*.e2e.ts"],
  maxInstances: 1,
  capabilities: [
    {
      browserName: "vscode",
      browserVersion: PINNED_VSCODE_VERSION,
      "wdio:vscodeOptions": {
        extensionPath: import.meta.dirname,
        storagePath: fixture.storagePath,
        userSettings: fixture.userSettings,
        verboseLogging: false,
        // Under xvfb there is no window manager, so Chromium may treat the
        // window as occluded and stop producing frames: no
        // requestAnimationFrame, no ResizeObserver, so the layout never follows
        // the panel's width (check 1.9).
        vscodeArgs: {
          "disable-renderer-backgrounding": true,
          "disable-backgrounding-occluded-windows": true,
          "disable-features": "CalculateNativeWinOcclusion",
        },
      },
    },
  ],
  services: [["vscode", { cachePath: path.join(import.meta.dirname, ".wdio-vscode-service") }]],
  framework: "mocha",
  reporters: ["spec"],
  logLevel: "warn",
  mochaOpts: { ui: "tdd", timeout: 120_000 },
  outputDir: path.join(import.meta.dirname, "test/ui/out"),
};
