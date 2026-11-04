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
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { readCopilotE2eEnv } from "./test/ui/copilot-e2e/support/copilot-e2e-env.mts";
import { copyProfile } from "./test/ui/copilot-e2e/support/profile-copy.mts";
import { PINNED_VSCODE_VERSION } from "./scripts/ui-automation/vscode-version.mts";

// wdio loads this file in the launcher and again in every worker; only the
// launcher copies the profile and reports the skip.
const ROOT_ENV = "AI_CREDITS_ANALYZER_COPILOT_E2E_ROOT";
export const COPILOT_E2E_SETTINGS = {
  // Local harness chats record token data only with debug logging on.
  "github.copilot.chat.agentDebugLog.fileLogging.enabled": true,
  "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs": 200,
  "aiCreditsAnalyzer.mcp.enabled": true,
  // Without this, agent mode asks before each MCP tool call and the chat
  // waits for a click. Unverified setting id on VS Code 1.145: if it is wrong
  // the 2.3/2.4 tests time out waiting for the tool call.
  "chat.tools.global.autoApprove": true,
  "workbench.startupEditor": "none",
  "extensions.autoCheckUpdates": false,
  "update.mode": "none",
  "telemetry.telemetryLevel": "off",
};

const env = readCopilotE2eEnv(process.env);
if (env.status === "skip") {
  if (process.env[ROOT_ENV] === undefined) console.log(`[copilot-e2e] SKIPPED: ${env.reason}`);
  // A skip is not a failure: exit 0 before wdio starts anything.
  process.exit(0);
}

const inWorker = process.env[ROOT_ENV] !== undefined;
const rootDir = process.env[ROOT_ENV] ?? mkdtempSync(path.join(tmpdir(), "aica-copilot-e2e-"));
const storagePath = path.join(rootDir, "storage");
if (!inWorker) {
  process.env[ROOT_ENV] = rootDir;
  process.env.AI_CREDITS_ANALYZER_COPILOT_E2E_MODEL = env.model;
  process.on("exit", () => rmSync(rootDir, { recursive: true, force: true }));
  mkdirSync(path.join(storagePath, "settings"), { recursive: true });
  copyProfile(env.userDataDir, path.join(storagePath, "settings"));
  console.log(`[copilot-e2e] running on a copy of ${env.userDataDir} (User and Local State only), expecting model ${env.model}; the copy is deleted afterwards`);
}

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./test/ui/copilot-e2e/specs/**/*.e2e.ts"],
  maxInstances: 1,
  capabilities: [
    {
      browserName: "vscode",
      browserVersion: PINNED_VSCODE_VERSION,
      "wdio:vscodeOptions": {
        extensionPath: import.meta.dirname,
        storagePath,
        userSettings: COPILOT_E2E_SETTINGS,
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
  // A real chat turn takes a while.
  mochaOpts: { ui: "tdd", timeout: 600_000 },
  outputDir: path.join(import.meta.dirname, "test/ui/out"),
};
