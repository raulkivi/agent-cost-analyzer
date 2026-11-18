// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Builds the Claude Desktop bundle (`npm run mcpb:build`, mcp-client-setup.md
// §5.7, MC15): the npm tarball's files plus a manifest.json, packed with the
// pinned `@anthropic-ai/mcpb`. Staging from the tarball (not from the build
// folders) keeps the bundle byte-identical to what npm ships, and the release
// workflow passes the very tarball it tested and publishes. Run after
// `npm run build`; the .mcpb goes to --out (default mcpb-release) and its SHA-256 is printed.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readTarFiles } from "../smoke/tarball.mts";
import { mcpbFileName, mcpbManifest, mcpbProblems, parseMcpbArgs, stagedPaths, type PackageFacts, type ToolEntry } from "./mcpb-plan.mts";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

function run(command: string, args: readonly string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} ended with ${result.status}`);
  return result.stdout;
}

// The pinned package's own bin, so no registry fetch and no other version runs.
const mcpbCli = path.join(repoRoot, "node_modules", "@anthropic-ai", "mcpb", "dist", "cli", "cli.js");

const args = parseMcpbArgs(process.argv.slice(2), process.cwd());
if (args.kind === "help") {
  process.stdout.write(args.text);
  process.exit(0);
}
if (args.kind === "error") {
  process.stderr.write(`${args.message}\n`);
  process.exit(2);
}

const scratch = mkdtempSync(path.join(tmpdir(), "mcpb-build-"));
try {
  let tarball = args.tarball;
  if (tarball === undefined) {
    const [report] = JSON.parse(run("npm", ["pack", "--workspace=packages/cli", "--pack-destination", scratch, "--json"], repoRoot)) as { filename: string }[];
    tarball = path.join(scratch, report!.filename);
  }
  const files = readTarFiles(readFileSync(tarball));
  const staged = stagedPaths(files.map((file) => file.path));

  const pkgFile = files.find((file) => file.path === "package/package.json");
  if (pkgFile === undefined) throw new Error("the tarball has no package.json");
  const pkg = JSON.parse(pkgFile.content.toString("utf8")) as PackageFacts;
  const snapshot = JSON.parse(
    readFileSync(path.join(repoRoot, "packages", "server", "src", "mcp", "__snapshots__", "tool-list-standalone.json"), "utf8"),
  ) as { withViews: { tools: ToolEntry[] } };
  const manifest = mcpbManifest(pkg, snapshot.withViews.tools);
  const problems = mcpbProblems(manifest, staged, pkg.version);
  if (problems.length > 0) throw new Error(`the bundle plan has problems:\n${problems.join("\n")}`);

  const stage = path.join(scratch, "stage");
  for (const file of files) {
    const target = path.join(stage, file.path.slice("package/".length));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.content);
  }
  writeFileSync(path.join(stage, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  run(process.execPath, [mcpbCli, "validate", path.join(stage, "manifest.json")], stage);
  mkdirSync(args.outDir, { recursive: true });
  const output = path.join(args.outDir, mcpbFileName(pkg.version));
  rmSync(output, { force: true });
  run(process.execPath, [mcpbCli, "pack", stage, output], stage);

  const sha = createHash("sha256").update(readFileSync(output)).digest("hex");
  process.stdout.write(`${output}  ${(statSync(output).size / 1000).toFixed(1)} kB  sha256 ${sha}\n`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
