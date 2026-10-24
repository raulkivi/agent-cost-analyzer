// @vscode/test-cli's configuration for the real-VS Code integration suite
// (vscode-extension.md step 10.9, D9): `npm run test:integration`, after
// `npm run build`. It seeds a throwaway VS Code user-data dir (settings plus
// 200 Copilot Chat sessions) before VS Code starts, runs the `stable` build
// on it with no other extensions, and tells the suite about it through the
// environment. Node loads the .mts fixture modules directly (type stripping,
// Node >= 22.18).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { defineConfig } from "@vscode/test-cli";
import { INTEGRATION_FIXTURE_ENV } from "./scripts/integration-fixture-env.mts";
import { createIntegrationFixture } from "./scripts/integration-fixture.mts";

// A short path: VS Code keeps IPC sockets under the user-data dir, and
// socket paths are length-limited.
const rootDir = mkdtempSync(path.join(tmpdir(), "aica-it-"));
process.on("exit", () => rmSync(rootDir, { recursive: true, force: true }));
const fixture = createIntegrationFixture(rootDir);

export default defineConfig({
  label: "integration",
  files: "out/integration/**/*.test.js",
  version: "stable",
  launchArgs: [`--user-data-dir=${fixture.userDataDir}`, `--extensions-dir=${path.join(rootDir, "extensions")}`, "--disable-extensions"],
  env: { [INTEGRATION_FIXTURE_ENV]: JSON.stringify(fixture) },
  mocha: { ui: "tdd", timeout: 120_000 },
});
