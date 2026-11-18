// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// What the Claude Desktop bundle (`.mcpb`) holds and says (mcp-client-setup.md
// §5.7, MC15): pure planning, so build-mcpb.mts and the tests share it. The
// bundle is the npm tarball's files plus a manifest.json, so the two can't
// disagree about what the app is.
import path from "node:path";
import { parseArgs } from "node:util";

export const MCPB_MANIFEST_VERSION = "0.3";
const REPO_URL = "https://github.com/raulkivi/agent-cost-analyzer";
// The gated shim, not dist/cli.js: an old Node gets the shim's clear message.
const ENTRY = "bin/agent-cost-analyzer.js";

export interface PackageFacts {
  name: string;
  version: string;
  engines: { node: string };
}

export interface ToolEntry {
  name: string;
  title?: string;
}

export interface McpbManifest {
  manifest_version: string;
  name: string;
  display_name: string;
  version: string;
  description: string;
  author: { name: string };
  license: string;
  repository: { type: string; url: string };
  homepage: string;
  server: { type: "node"; entry_point: string; mcp_config: { command: string; args: string[] } };
  tools: { name: string; description: string }[];
  tools_generated: boolean;
  compatibility: { runtimes: { node: string } };
}

export const mcpbFileName = (version: string): string => `agent-cost-analyzer-${version}.mcpb`;

/** The staged file list for a tarball's entries (`package/...`): the same files, plus manifest.json. */
export function stagedPaths(tarballPaths: readonly string[]): string[] {
  const staged = tarballPaths.map((entry) => {
    if (!entry.startsWith("package/")) throw new Error(`tarball entry ${entry} is outside package/`);
    const relative = entry.slice("package/".length);
    if (relative.split("/").includes("..") || path.isAbsolute(relative)) throw new Error(`unsafe tarball entry ${entry}`);
    return relative;
  });
  return [...new Set([...staged, "manifest.json"])].sort();
}

/** `tools` comes from the tool-list snapshot's entries, so the manifest names exactly what the server lists. */
export function mcpbManifest(pkg: PackageFacts, tools: readonly ToolEntry[]): McpbManifest {
  return {
    manifest_version: MCPB_MANIFEST_VERSION,
    name: pkg.name,
    display_name: "Agent Cost Analyzer",
    version: pkg.version,
    description:
      "Read-only analysis of what your AI coding agents cost: sessions, turns, tokens and prompt caching from Copilot Chat, Claude Code, pi and mitmproxy logs on this computer.",
    author: { name: "Raul Kivi" },
    license: "MIT",
    repository: { type: "git", url: REPO_URL },
    homepage: `${REPO_URL}#readme`,
    server: {
      type: "node",
      entry_point: ENTRY,
      mcp_config: { command: "node", args: [`\${__dirname}/${ENTRY}`, "mcp"] },
    },
    tools: tools.map((tool) => ({ name: tool.name, description: tool.title ?? tool.name })),
    tools_generated: false,
    // The package's own range, so the gate and the bundle agree.
    compatibility: { runtimes: { node: pkg.engines.node } },
  };
}

const REQUIRED = ["LICENSE", "THIRD-PARTY-NOTICES.md", "package.json", "manifest.json", "bin/node-gate.js", "dist/cli.js"];

export function mcpbProblems(manifest: McpbManifest, staged: readonly string[], version: string): string[] {
  const present = new Set(staged);
  const args = manifest.server.mcp_config.args;
  return [
    ...(manifest.version === version ? [] : [`version is ${JSON.stringify(manifest.version)}, expected ${JSON.stringify(version)}`]),
    ...(present.has(manifest.server.entry_point) ? [] : [`entry_point ${manifest.server.entry_point} is not staged`]),
    ...(args.at(-1) === "mcp" ? [] : [`mcp_config.args must end with "mcp"`]),
    ...(args[0] === `\${__dirname}/${manifest.server.entry_point}` ? [] : [`mcp_config.args must start with \${__dirname}/${manifest.server.entry_point}`]),
    ...REQUIRED.filter((file) => !present.has(file)).map((file) => `${file} is not staged`),
  ];
}

/** The unpacked bundle's files against the tarball's: nothing the npm package does not ship, except manifest.json. */
export function bundleListProblems(tarballPaths: readonly string[], bundlePaths: readonly string[]): string[] {
  const want = new Set(stagedPaths(tarballPaths));
  const have = new Set(bundlePaths);
  return [
    ...[...want].filter((file) => !have.has(file)).map((file) => `the bundle lacks ${file}`),
    ...[...have].filter((file) => !want.has(file)).map((file) => `the bundle holds ${file}, which the tarball does not`),
  ];
}

export type McpbArgs = { kind: "run"; tarball: string | undefined; outDir: string } | { kind: "error"; message: string } | { kind: "help"; text: string };

const USAGE = [
  "Usage: npm run mcpb:build -- [--tarball <path>] [--out <dir>]",
  "",
  "  --tarball <path>  Stage this packed tarball (the release workflow's); without it, npm pack of the current build",
  "  --out <dir>       Where the .mcpb goes (default mcpb-release)",
  "",
].join("\n");

export function parseMcpbArgs(argv: readonly string[], cwd: string): McpbArgs {
  try {
    const { values } = parseArgs({
      args: [...argv],
      options: { tarball: { type: "string" }, out: { type: "string" }, help: { type: "boolean", short: "h" } },
      strict: true,
    });
    if (values.help === true) return { kind: "help", text: USAGE };
    return {
      kind: "run",
      tarball: values.tarball === undefined ? undefined : path.resolve(cwd, values.tarball),
      outDir: path.resolve(cwd, values.out ?? "mcpb-release"),
    };
  } catch (error) {
    return { kind: "error", message: `${error instanceof Error ? error.message : String(error)}\n\n${USAGE}` };
  }
}
