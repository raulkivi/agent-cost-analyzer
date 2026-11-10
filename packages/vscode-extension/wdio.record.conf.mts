// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Records VS Code's own colour sets (A24 step 1.7a, replaced by wdio in step
// 10.17 task G6): for each High Contrast theme it runs "Developer: Generate
// Color Theme From Current Settings" and writes the result under
// docs/plans/mcp-apps-a24-results/. An owner-run recorder, not a test: it is
// not part of `test:ui:vscode` or CI. Run it after a VS Code version bump:
//   xvfb-run -a -s "-screen 0 1600x1000x24" npm run record:host-themes
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { PINNED_VSCODE_VERSION } from "./scripts/ui-automation/vscode-version.mts";

const ROOT_ENV = "AI_CREDITS_ANALYZER_RECORD_ROOT";
const inWorker = process.env[ROOT_ENV] !== undefined;
// A short path: VS Code keeps IPC sockets under the user-data dir.
const rootDir = process.env[ROOT_ENV] ?? mkdtempSync(path.join(tmpdir(), "aica-rec-"));
if (!inWorker) {
  process.env[ROOT_ENV] = rootDir;
  process.on("exit", () => rmSync(rootDir, { recursive: true, force: true }));
}

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./test/ui/record/**/*.record.ts"],
  maxInstances: 1,
  capabilities: [
    {
      browserName: "vscode",
      browserVersion: PINNED_VSCODE_VERSION,
      "wdio:vscodeOptions": {
        // The recorder needs only the workbench, not the analyzer.
        extensionPath: path.join(import.meta.dirname, "test/ui/fixtures/empty-extension"),
        storagePath: path.join(rootDir, "storage"),
        userSettings: { "workbench.startupEditor": "none", "update.mode": "none", "telemetry.telemetryLevel": "off" },
        verboseLogging: false,
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
