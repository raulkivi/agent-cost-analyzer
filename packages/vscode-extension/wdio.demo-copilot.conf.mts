// Records the opt-in demo scenes that need a REAL signed-in Copilot Chat
// (docs/plans/docs-refresh-and-demo-recordings.md §5, task 1.3), into MP4 masters
// in demo-masters/. Like the release suite, it does nothing (exit 0 with the
// reason) unless COPILOT_E2E=1 and COPILOT_E2E_USER_DATA_DIR name the profile
// you signed in with, and scenes that send a prompt spend AI Credits up to
// COPILOT_E2E_MAX_AI_CREDITS:
//
//   COPILOT_E2E=1 COPILOT_E2E_USER_DATA_DIR=~/.cache/aica-copilot-e2e/user-data npm run demo:record:copilot
//
// How VS Code launches on the profile copy is copilot-launch.mts, shared with
// wdio.copilot.conf.mts; this config adds none of the release evidence (no
// results reporter, no git note). Not part of `test:ui:vscode`, CI or `npm test`.
import path from "node:path";
import { browser } from "@wdio/globals";
import { prepareCopilotLaunch } from "./test/ui/copilot-e2e/support/copilot-launch.mts";
import { assertWindowFillsFrame, dropSavedWindowState, readWindowBox, DEMO_USER_SETTINGS } from "./test/ui/demo/support/demo-launch.mts";

// Keeps the default root variable: sendToAgent reads it for the run log and the AI Credits cap.
const launch = prepareCopilotLaunch({
  specs: ["./test/ui/demo-copilot/**/*.demo.ts"],
  userSettings: DEMO_USER_SETTINGS,
  seedChatHistory: true,
  tmpPrefix: "aica-demo-copilot-",
});

export const config: WebdriverIO.Config = {
  runner: "local",
  ...launch.config,
  // Before each VS Code start: the copy's saved window position would shift the window out of the frame.
  onWorkerStart: (cid, capabilities, specs, args, execArgv) => {
    dropSavedWindowState(path.join(launch.paths.settingsDir, "User", "globalStorage", "storage.json"));
    for (const hook of [launch.config.onWorkerStart].flat()) hook(cid, capabilities, specs, args, execArgv);
  },
  framework: "mocha",
  reporters: ["spec"],
  logLevel: "warn",
  // A real chat turn takes a while.
  mochaOpts: { ui: "tdd", timeout: 600_000 },
  outputDir: path.join(import.meta.dirname, "test/ui/out"),
  before: async () => {
    await assertWindowFillsFrame(() => browser.execute(readWindowBox));
  },
};
