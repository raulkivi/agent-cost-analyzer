// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The smoke's checks of the `agent-cost-analyser` alias (npm-package.md D3,
// §4.8): its tarball, then both tarballs installed with no registry and the
// alias run as a user would (`--version`, `--help`, an MCP initialize).
import { readFileSync } from "node:fs";
import path from "node:path";
import { usageText } from "../src/usage.ts";
import { firstStdoutLine, runToEnd, start, stop, withTimeout } from "./io.mts";
import { installedBin, invocation } from "./processes.mts";
import { readTarFiles } from "./tarball.mts";

export const ALIAS = {
  name: "agent-cost-analyser", // codespell:ignore analyser
  bin: "agent-cost-analyser", // codespell:ignore analyser
  shim: "bin/run.js",
  dependencies: { "agent-cost-analyzer": ">=0.16.0 <2" },
  files: ["LICENSE", "README.md", "bin/run.js", "package.json"],
} as const;

/** Everything wrong with a packed alias tarball of `version`; empty when it may ship. */
export function aliasTarballProblems(tgz: Buffer, version: string): string[] {
  const files = new Map(readTarFiles(tgz).map((file) => [file.path, file.content]));
  const names = [...files.keys()].map((name) => name.replace(/^package\//, "")).sort();
  const problems: string[] = [];
  if (JSON.stringify(names) !== JSON.stringify(ALIAS.files)) problems.push(`files are ${JSON.stringify(names)}, expected ${JSON.stringify(ALIAS.files)}`);
  const manifest = JSON.parse(files.get("package/package.json")?.toString("utf8") ?? "{}") as Record<string, unknown>;
  const expectEqual = (label: string, actual: unknown, expected: unknown) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) problems.push(`${label} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  };
  expectEqual("name", manifest.name, ALIAS.name);
  expectEqual("version", manifest.version, version);
  expectEqual("dependencies", manifest.dependencies, ALIAS.dependencies);
  expectEqual("bin", manifest.bin, { [ALIAS.bin]: ALIAS.shim });
  for (const key of ["scripts", "gypfile", "optionalDependencies", "peerDependencies", "bundleDependencies", "bundledDependencies"]) {
    if (manifest[key] !== undefined) problems.push(`has ${key}; the alias must have none`);
  }
  const shim = files.get(`package/${ALIAS.shim}`)?.toString("utf8") ?? "";
  if (!shim.startsWith("#!/usr/bin/env node\n")) problems.push(`${ALIAS.shim} does not start with #!/usr/bin/env node and LF`);
  if (shim.includes("\r")) problems.push(`${ALIAS.shim} has CR line endings`);
  return problems;
}

/** `npm pack` of a workspace into `dest`; resolves to the tarball's path. */
export async function packWorkspace(platform: NodeJS.Platform, repoRoot: string, workspace: string, dest: string): Promise<string> {
  const pack = await runToEnd(invocation(platform, "npm", ["pack", `--workspace=${workspace}`, "--pack-destination", dest, "--json"]), {
    cwd: repoRoot,
    env: process.env,
    timeoutMs: 5 * 60_000,
  });
  if (pack.code !== 0) throw new Error(`npm pack ${workspace} ended with ${pack.code}:\n${pack.stderr}`);
  const [report] = JSON.parse(pack.stdout) as { filename: string }[];
  return path.join(dest, report!.filename);
}

export interface AliasCheck {
  platform: NodeJS.Platform;
  /** An empty project folder (with a package.json). */
  project: string;
  /** The isolated environment: no registry, a fixture home. */
  env: Record<string, string>;
  mainTarball: string;
  aliasTarball: string;
  /** The real package's version, which the alias prints. */
  version: string;
  aliasVersion: string;
  timeoutMs: number;
}

const exitProblems = (label: string, code: number | string): string[] => (code === 0 ? [] : [`${label} ended with ${code}, expected 0`]);

async function mcpProblems(check: AliasCheck): Promise<string[]> {
  const { platform, project, env } = check;
  const server = start(invocation(platform, installedBin(platform, project, ALIAS.bin), ["mcp"]), { cwd: project, env });
  try {
    server.child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "alias-smoke", version: "0" } } })}\n`,
    );
    const line = await firstStdoutLine(server, check.timeoutMs, []);
    const reply = JSON.parse(line) as { id?: number; result?: { serverInfo?: { version?: string } } };
    server.child.stdin.end();
    const code = await withTimeout(server.exited, 30_000, "the alias's MCP server exit after stdin closed");
    return [
      ...(reply.id === 1 && reply.result?.serverInfo?.version === check.version
        ? []
        : [`mcp initialize answered ${JSON.stringify(reply)}, expected server version ${check.version}`]),
      ...exitProblems("the alias's MCP server", code),
    ];
  } catch (error) {
    await stop(server, platform, 10_000).catch(() => undefined);
    return [`mcp initialize failed: ${error instanceof Error ? error.message : String(error)}; stderr:\n${server.stderr()}`];
  }
}

/** Installs both tarballs with no registry and runs the alias; every problem found, empty when it works. */
export async function aliasProblems(check: AliasCheck): Promise<string[]> {
  const { platform, project, env } = check;
  const tarballProblems = aliasTarballProblems(readFileSync(check.aliasTarball), check.aliasVersion);
  if (tarballProblems.length > 0) return tarballProblems;

  const install = await runToEnd(invocation(platform, "npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", check.mainTarball, check.aliasTarball]), {
    cwd: project,
    env,
    timeoutMs: check.timeoutMs,
  });
  if (install.code !== 0) return [`npm install of both tarballs ended with ${install.code}:\n${install.stderr}`];

  const problems: string[] = [];
  for (const [flag, expected] of [
    ["--version", `${check.version}\n`],
    ["--help", usageText()],
  ] as const) {
    const run = await runToEnd(invocation(platform, installedBin(platform, project, ALIAS.bin), [flag]), { cwd: project, env, timeoutMs: check.timeoutMs });
    problems.push(...exitProblems(`${ALIAS.bin} ${flag}`, run.code));
    if (run.stdout !== expected) problems.push(`${ALIAS.bin} ${flag} printed ${JSON.stringify(run.stdout)}, expected ${JSON.stringify(expected)}`);
  }
  return [...problems, ...(await mcpProblems(check))];
}
