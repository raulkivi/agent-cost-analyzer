// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The mcp-setup smoke (docs/plans/mcp-client-setup.md §7, task MC7): install
// the packed `agent-cost-analyzer` tarball with no registry, then run its
// `mcp config`, `mcp status`, `mcp install` and `mcp uninstall` for all six
// clients against a temporary home, with stand-ins for the claude, codex,
// gemini and npx CLIs, and launch each written JSON entry through the MCP
// client SDK. Linux only (owner decision D13); CI's `npm-package` job runs it
// on its Linux legs.
//
// Run it locally (Linux, Node 22.18 or newer, after `npm ci`):
//   npm run smoke:mcp-setup                  # npm run build, npm pack, then the checks
//   npm run smoke:mcp-setup -- --tarball <path.tgz> [--out <dir>] [--keep-temp]
// Logs go to packages/cli/smoke/out/mcp-setup (or --out).
import path from "node:path";
import { parseSetupSmokeArgs } from "../packages/cli/smoke/setup-options.mts";
import { runSetupSmoke } from "../packages/cli/smoke/setup-run.mts";

const repoRoot = path.resolve(import.meta.dirname, "..");
const args = parseSetupSmokeArgs(process.argv.slice(2), process.cwd());
if (args.kind === "help") {
  process.stdout.write(args.text);
} else if (args.kind === "error") {
  process.stderr.write(`${args.message}\n`);
  process.exitCode = 2;
} else if (process.platform !== "linux") {
  // D13: macOS and Windows are covered by unit tests with an injected platform only.
  process.stdout.write(`mcp-setup smoke: skipped on ${process.platform}; it runs on Linux only (mcp-client-setup.md D13)\n`);
} else {
  process.exitCode = await runSetupSmoke({ repoRoot, ...(args.tarball === undefined ? {} : { tarball: args.tarball }), outDir: args.outDir, keepTemp: args.keepTemp });
}
