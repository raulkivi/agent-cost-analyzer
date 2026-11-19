// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The Claude Desktop bundle smoke (docs/plans/mcp-client-setup.md §5.7, task
// MC15): unpack the `.mcpb`, check its files against the npm tarball's, start
// its server with the manifest's own command and require `tools/list` to
// match the tool-list snapshot. Linux only (owner decision D13); CI's
// `npm-package` job runs it on its Linux legs and the release build job runs
// it on the bundle it attaches.
//
// Run it locally (Linux, Node 22.18 or newer, after `npm ci` and `npm run build`):
//   npm run smoke:mcpb                                       # npm pack, mcpb:build, then the checks
//   npm run smoke:mcpb -- --tarball <path.tgz> --bundle <path.mcpb>
// The steps live in packages/cli/smoke/mcpb-run.mts.
import path from "node:path";
import { parseArgs } from "node:util";
import { runMcpbSmoke } from "../packages/cli/smoke/mcpb-run.mts";

const repoRoot = path.resolve(import.meta.dirname, "..");

if (process.platform !== "linux") {
  // D13: macOS and Windows are covered by unit tests only.
  process.stdout.write(`mcpb smoke: skipped on ${process.platform}; it runs on Linux only (mcp-client-setup.md D13)\n`);
} else {
  const { values } = parseArgs({ options: { tarball: { type: "string" }, bundle: { type: "string" } }, strict: true });
  const problems = await runMcpbSmoke({
    repoRoot,
    ...(values.tarball === undefined ? {} : { tarball: path.resolve(values.tarball) }),
    ...(values.bundle === undefined ? {} : { bundle: path.resolve(values.bundle) }),
  });
  for (const problem of problems) process.stderr.write(`FAIL ${problem}\n`);
  process.stdout.write(problems.length === 0 ? "mcpb smoke: ok\n" : "");
  process.exitCode = problems.length === 0 ? 0 : 1;
}
