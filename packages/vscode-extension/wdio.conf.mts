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
import { UI_FIXTURE_ENV } from "./test/ui/support/ui-fixture-env.mts";
import { createUiFixture } from "./scripts/ui-automation/ui-fixture.mts";

// Pinned (F9): page-object locators fall back to the 1.123 set for any
// newer stable, and patch releases can 404 on chromedriver (issue #157).
export const PINNED_VSCODE_VERSION = "1.145.0";

// The spec that needs Workspace Trust on and a workspace folder (check 2.5);
// it gets its own VS Code launch, and every other spec runs in the main one.
const TRUST_SPEC = "./test/ui/specs/mcp-trust.e2e.ts";

// A short path: VS Code keeps IPC sockets under the user-data dir.
const rootDir = mkdtempSync(path.join(tmpdir(), "aica-ui-"));
process.on("exit", () => rmSync(rootDir, { recursive: true, force: true }));
const fixture = createUiFixture(rootDir);
process.env[UI_FIXTURE_ENV] = JSON.stringify(fixture);
// The Copilot CLI event log is read from COPILOT_HOME (F5); the launcher's
// environment reaches chromedriver and so VS Code.
process.env.COPILOT_HOME = fixture.copilotHome;

// Check 2.5: a folder whose own settings turn the MCP server on, opened with
// Workspace Trust enabled (the service disables it by default, F8), so VS Code
// starts it in Restricted Mode.
const trustFixture = createUiFixture(path.join(rootDir, "trust"), { sessionCount: 1 });
const trustWorkspace = path.join(rootDir, "trust-workspace");
mkdirSync(path.join(trustWorkspace, ".vscode"), { recursive: true });
writeFileSync(path.join(trustWorkspace, ".vscode", "settings.json"), `${JSON.stringify({ "aiCreditsAnalyzer.mcp.enabled": true }, null, 2)}\n`);

// Under xvfb there is no window manager, so Chromium may treat the window as
// occluded and stop producing frames.
const CHROMIUM_FLAGS = {
  "disable-renderer-backgrounding": true,
  "disable-backgrounding-occluded-windows": true,
  "disable-features": "CalculateNativeWinOcclusion",
};

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
        vscodeArgs: CHROMIUM_FLAGS,
      },
      ...({ exclude: [TRUST_SPEC] } as object),
    },
    {
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
      // wdio reads per-capability spec lists; its capability type doesn't declare them.
      ...({ specs: [TRUST_SPEC] } as object),
    },
  ],
  services: [["vscode", { cachePath: path.join(import.meta.dirname, ".wdio-vscode-service") }]],
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
    for (const [label, { userDataDir }] of [["main", fixture], ["trust", trustFixture]] as const) {
      if (existsSync(path.join(userDataDir, "logs"))) cpSync(path.join(userDataDir, "logs"), path.join(OUT_DIR, `${name}-logs-${label}`), { recursive: true, force: true });
    }
  },
};
