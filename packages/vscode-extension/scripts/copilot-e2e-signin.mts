// One-time setup for the opt-in real-Copilot suite (docs/plans/vscode-ui-automation.md §7):
// opens the pinned VS Code on a THROWAWAY user-data dir so you can sign in to
// GitHub Copilot there, and pick the model (the chat's model picker; VS Code
// remembers it in that profile). Close the window when done. The sign-in is
// kept by VS Code in that dir (--password-store=basic; copilot-vscode-args.mts
// gives the suite the same store, or it couldn't decrypt the sign-in); this
// script never reads it. Needs a display.
//
//   COPILOT_E2E_USER_DATA_DIR=~/.cache/aica-copilot-e2e/user-data npm run test:ui:vscode:copilot:signin
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { download } from "@vscode/test-electron";
import { copilotSignInArgs } from "./ui-automation/copilot-vscode-args.mts";
import { PINNED_VSCODE_VERSION } from "./ui-automation/vscode-version.mts";

const userDataDir = process.env.COPILOT_E2E_USER_DATA_DIR ?? path.join(homedir(), ".cache", "aica-copilot-e2e", "user-data");
mkdirSync(userDataDir, { recursive: true });
const cachePath = path.resolve(import.meta.dirname, "../.wdio-vscode-service");

const executable = await download({ cachePath, version: PINNED_VSCODE_VERSION });
console.log(`Opening VS Code ${PINNED_VSCODE_VERSION} on ${userDataDir}.`);
console.log("1. Sign in to GitHub (Accounts menu), enable Copilot Chat if asked.");
console.log("2. Open Copilot Chat in agent mode and pick the model you want the suite to use (default Claude Haiku 5.5).");
console.log("3. Close the window. Then: COPILOT_E2E=1 COPILOT_E2E_USER_DATA_DIR=<that dir> npm run test:ui:vscode:copilot");
const child = spawn(executable, copilotSignInArgs(userDataDir), { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
