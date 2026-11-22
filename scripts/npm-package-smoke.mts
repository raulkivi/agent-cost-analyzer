// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The npm-package smoke (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/npm-package.md §4.8): pack the
// `agent-cost-analyzer` package, check the tarball, install it and run it
// through `npx` with scripts off and no registry, start the app and check it
// over HTTP and in Chromium, run `agent-cost-analyzer mcp` through the MCP
// client SDK, run the `agent-cost-analyser` alias installed next to it, and check that only the app's settings folder changed in the // codespell:ignore analyser
// seeded fixture home. CI's `npm-package` job runs it; the release workflow
// runs it on the tarball it publishes.
//
// Run it locally (Node 22.18 or newer, after `npm ci`):
//   npx playwright install chromium            # once
//   npm run smoke:npm-package                  # npm run build, npm pack, then the checks
//   npm run smoke:npm-package -- --tarball <path.tgz> [--alias-tarball <path.tgz>] [--out <dir>] [--keep-temp]
// Logs and Playwright output go to packages/cli/smoke/out (or --out).
// The steps live in packages/cli/smoke/ (run.mts; the checks are pure and
// unit-tested there).
import path from "node:path";
import { parseSmokeArgs } from "../packages/cli/smoke/options.mts";
import { runSmoke } from "../packages/cli/smoke/run.mts";

const repoRoot = path.resolve(import.meta.dirname, "..");
const args = parseSmokeArgs(process.argv.slice(2), process.cwd());
if (args.kind === "help") {
  process.stdout.write(args.text);
} else if (args.kind === "error") {
  process.stderr.write(`${args.message}\n`);
  process.exitCode = 2;
} else {
  process.exitCode = await runSmoke({ repoRoot, ...(args.tarball === undefined ? {} : { tarball: args.tarball }), ...(args.aliasTarball === undefined ? {} : { aliasTarball: args.aliasTarball }), outDir: args.outDir, keepTemp: args.keepTemp });
}
