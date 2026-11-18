// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The Claude Desktop bundle smoke's steps (mcp-client-setup.md §5.7, MC15):
// unpack the `.mcpb` as Desktop does, check its files against the npm
// tarball's, start the server with the command and arguments its
// manifest.json gives (`${__dirname}` replaced by the unpacked folder) and
// require `initialize` and `tools/list` to match the tool-list snapshot.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { bundleListProblems, mcpbFileName, type McpbManifest } from "../scripts/mcpb-plan.mts";
import { createFixtureHome } from "../../web/e2e/support/fixture-home.mts";
import { expectedMcpSurface, jsonRpcLineProblems, mcpSurfaceProblems } from "./checks.mts";
import { start, withTimeout } from "./io.mts";
import { RecordingStdioTransport } from "./mcp-transport.mts";
import { isolatedEnv } from "./processes.mts";
import { exitProblems, MINUTE, warningProblems } from "./steps.mts";
import { readTarFiles } from "./tarball.mts";

export interface McpbSmokeOptions {
  repoRoot: string;
  /** The release workflow's already packed tarball; otherwise pack the current build. */
  tarball?: string;
  /** An already built bundle; otherwise build one from the tarball. */
  bundle?: string;
}

const filesIn = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"));

/** The problems found; none when the bundle unpacks to the tarball's files and its server answers as the package's does. */
export async function runMcpbSmoke({ repoRoot, tarball: tarballOption, bundle: bundleOption }: McpbSmokeOptions): Promise<string[]> {
  const run = (command: string, args: readonly string[]): string => {
    const result = spawnSync(command, args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
    if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} ended with ${result.status}`);
    return result.stdout;
  };

  const scratch = mkdtempSync(path.join(tmpdir(), "mcpb-smoke-"));
  try {
    let tarball = tarballOption;
    if (tarball === undefined) {
      const [report] = JSON.parse(run("npm", ["pack", "--workspace=packages/cli", "--pack-destination", scratch, "--json"])) as { filename: string }[];
      tarball = path.join(scratch, report!.filename);
    }
    const tarFiles = readTarFiles(readFileSync(tarball));
    const packageJson = tarFiles.find((file) => file.path === "package/package.json");
    if (packageJson === undefined) return ["the tarball has no package.json"];
    const version = (JSON.parse(packageJson.content.toString("utf8")) as { version: string }).version;

    let bundle = bundleOption;
    if (bundle === undefined) {
      run("node", ["packages/cli/scripts/build-mcpb.mts", "--tarball", tarball, "--out", path.join(scratch, "out")]);
      bundle = path.join(scratch, "out", mcpbFileName(version));
    }

    // `mcpb unpack` is the pinned package's own reader of the format.
    const unpacked = path.join(scratch, "unpacked");
    run("node", ["node_modules/@anthropic-ai/mcpb/dist/cli/cli.js", "unpack", bundle, unpacked]);
    const problems = bundleListProblems(
      tarFiles.map((file) => file.path),
      filesIn(unpacked),
    );

    const manifest = JSON.parse(readFileSync(path.join(unpacked, "manifest.json"), "utf8")) as McpbManifest;
    const { command, args } = manifest.server.mcp_config;
    // What Desktop does with the placeholder.
    const launch = args.map((arg) => arg.replaceAll("${__dirname}", unpacked));

    const home = path.join(scratch, "home");
    const project = path.join(scratch, "project");
    mkdirSync(project, { recursive: true });
    createFixtureHome(home);
    const env = isolatedEnv(process.env, { home, npmCache: path.join(scratch, "npm-cache"), platform: "linux" });
    const server = start({ command, args: launch }, { cwd: project, env });
    const transport = new RecordingStdioTransport(server.child);
    const client = new Client({ name: "mcpb-smoke", version });
    const expected = expectedMcpSurface(
      JSON.parse(readFileSync(path.join(repoRoot, "packages", "server", "src", "mcp", "__snapshots__", "tool-list-standalone.json"), "utf8")),
    );
    let actual: { version: string | undefined; tools: string[]; resources: string[] } | undefined;
    try {
      await withTimeout(client.connect(transport), MINUTE, "MCP initialize");
      actual = {
        version: client.getServerVersion()?.version,
        tools: (await client.listTools()).tools.map((tool) => tool.name),
        resources: (await client.listResources()).resources.map((resource) => resource.uri),
      };
    } finally {
      await client.close();
    }
    const code = await withTimeout(server.exited, 30_000, "the MCP server's exit after stdin closed");
    process.stdout.write(`bundle ${path.basename(bundle)}: ${actual?.tools.length ?? 0} tools listed\n`);
    return [
      ...problems,
      ...(actual === undefined ? ["the MCP client read no surface"] : mcpSurfaceProblems(expected, actual, version)),
      ...(manifest.tools.map((tool) => tool.name).sort().join() === expected.tools.join() ? [] : ["manifest.json lists tools the server does not, or lacks some"]),
      ...jsonRpcLineProblems(transport.lines),
      ...exitProblems("the bundled MCP server, after stdin closed,", code),
      ...warningProblems("the bundled MCP server", server.stderr()),
    ];
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
