// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The npm-package smoke (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/npm-package.md §4.8 steps 1-7), in order. Each
// step gathers facts and hands them to a pure check (checks.mts, home.mts,
// tarball.mts); the first step with problems stops the run.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { usageText } from "../src/usage.ts";
import { createFixtureHome } from "../../web/e2e/support/fixture-home.mts";
import {
  expectedMcpSurface,
  jsonRpcLineProblems,
  mcpSurfaceProblems,
  moduleScriptPath,
  parseStartLine,
  serveProblems,
  type McpSurface,
  type StartLine,
} from "./checks.mts";
import { aliasProblems, packWorkspace } from "./alias.mts";
import { appSettingsDirIn, changesOutside, snapshotTree, treeChanges } from "./home.mts";
import { firstStdoutLine, httpGet, kill, runToEnd, start, stop, withTimeout, type Running } from "./io.mts";
import { RecordingStdioTransport } from "./mcp-transport.mts";
import { installedBin, invocation, isolatedEnv } from "./processes.mts";
import { buildAndPack, exitProblems, logger, MINUTE, step, StepFailed, warningProblems } from "./steps.mts";
import { tarballProblems } from "./tarball.mts";

export interface SmokeOptions {
  repoRoot: string;
  /** An already packed tarball (the release workflow's); otherwise build and pack. */
  tarball?: string;
  /** The alias's already packed tarball (the release workflow's); otherwise pack it. */
  aliasTarball?: string;
  outDir: string;
  keepTemp: boolean;
  platform?: NodeJS.Platform;
}

interface Context {
  platform: NodeJS.Platform;
  repoRoot: string;
  outDir: string;
  version: string;
  dirs: { pack: string; home: string; npmCache: string; project: string; npx: string; alias: string };
  aliasVersion: string;
  env: Record<string, string>;
  running: Running[];
}

async function serveChecks(context: Context, log: (line: string) => void): Promise<string[]> {
  const { platform, dirs, env, version } = context;
  const server = start(invocation(platform, installedBin(platform, dirs.project), ["--no-open", "--port", "0"]), { cwd: dirs.project, env });
  context.running.push(server);
  const laterLines: string[] = [];
  let line: string;
  try {
    line = await firstStdoutLine(server, MINUTE, laterLines);
  } finally {
    writeFileSync(path.join(context.outDir, "serve.stderr.log"), server.stderr());
  }
  log(`  ${line}`);
  const started: StartLine | undefined = parseStartLine(line);
  if (started === undefined) return [`unexpected start line: ${JSON.stringify(line)}`];
  if (started.version !== version) return [`the start line names version ${started.version}, expected ${version}`];

  const index = await httpGet(started.port, "/");
  const assetPath = moduleScriptPath(index.body);
  const problems = serveProblems(
    {
      health: await httpGet(started.port, "/api/health"),
      index,
      packagedIndex: readFileSync(path.join(dirs.project, "node_modules", "agent-cost-analyzer", "dist", "web", "index.html"), "utf8"),
      ...(assetPath === undefined ? {} : { asset: { path: assetPath, reply: await httpGet(started.port, assetPath) } }),
      foreignHost: await httpGet(started.port, "/api/health", { Host: "evil.example" }),
    },
    version,
  );
  if (problems.length > 0) return problems;

  log("  the Playwright load spec");
  const playwright = createRequire(import.meta.url).resolve("@playwright/test/cli");
  const spec = await runToEnd(
    { command: process.execPath, args: [playwright, "test", "-c", path.join(import.meta.dirname, "playwright.config.ts")] },
    {
      cwd: context.repoRoot,
      env: { ...process.env, AGENT_COST_ANALYZER_SMOKE_URL: started.origin, AGENT_COST_ANALYZER_SMOKE_OUT: path.join(context.outDir, "playwright") },
      timeoutMs: 5 * MINUTE,
      echo: true,
    },
  );
  writeFileSync(path.join(context.outDir, "playwright.log"), `${spec.stdout}\n${spec.stderr}`);

  const stopped = await stop(server, platform, 30_000);
  writeFileSync(path.join(context.outDir, "serve.stderr.log"), server.stderr());
  return [
    ...exitProblems("the Playwright load spec", spec.code),
    // Windows has no SIGINT for another process: the tree kill's exit code says nothing.
    ...(platform === "win32" ? [] : exitProblems("the server, on SIGINT,", stopped)),
    ...laterLines.map((extra) => `the server wrote more to stdout than its start line: ${JSON.stringify(extra)}`),
    ...warningProblems("the server", server.stderr()),
  ];
}

interface Structured {
  providers?: { id: string; available: boolean }[];
}

async function mcpChecks(context: Context, log: (line: string) => void): Promise<string[]> {
  const { platform, dirs, env, version } = context;
  const server = start(invocation(platform, installedBin(platform, dirs.project), ["mcp"]), { cwd: dirs.project, env });
  context.running.push(server);
  const transport = new RecordingStdioTransport(server.child);
  const client = new Client({ name: "npm-package-smoke", version });
  const expected = expectedMcpSurface(
    JSON.parse(readFileSync(path.join(context.repoRoot, "packages", "server", "src", "mcp", "__snapshots__", "tool-list-standalone.json"), "utf8")),
  );
  let actual: (McpSurface & { version?: string }) | undefined;
  try {
    await withTimeout(client.connect(transport), MINUTE, "MCP initialize");
    actual = {
      version: client.getServerVersion()?.version,
      tools: (await client.listTools()).tools.map((tool) => tool.name),
      resources: (await client.listResources()).resources.map((resource) => resource.uri),
    };
    // Reads every available provider's logs, so the write-scope check sees
    // the app read them without writing.
    const listed = (await client.callTool({ name: "list_log_providers", arguments: {} })).structuredContent as Structured | undefined;
    const available = (listed?.providers ?? []).filter((provider) => provider.available).map((provider) => provider.id);
    log(`  read sessions of: ${available.join(", ") || "(no provider available)"}`);
    for (const provider of available) {
      const result = await client.callTool({ name: "list_sessions", arguments: { provider } });
      if (result.isError === true) return [`list_sessions for ${provider} failed: ${JSON.stringify(result.content)}`];
    }
  } finally {
    await client.close();
    writeFileSync(path.join(context.outDir, "mcp.stdout.log"), `${transport.lines.join("\n")}\n`);
  }
  const code = await withTimeout(server.exited, 30_000, "the MCP server's exit after stdin closed");
  writeFileSync(path.join(context.outDir, "mcp.stderr.log"), server.stderr());
  return [
    ...(actual === undefined ? ["the MCP client read no surface"] : mcpSurfaceProblems(expected, actual, version)),
    ...jsonRpcLineProblems(transport.lines),
    ...exitProblems("the MCP server, after stdin closed,", code),
    ...warningProblems("the MCP server", server.stderr()),
  ];
}

async function smoke(context: Context, tarballOption: string | undefined, aliasOption: string | undefined, log: (line: string) => void): Promise<void> {
  const { platform, dirs, version } = context;
  let tarball = tarballOption ?? "";
  await step(log, tarballOption === undefined ? "build and pack (npm run build, npm pack)" : `use ${tarballOption}`, async () => {
    if (tarballOption === undefined) tarball = await buildAndPack(platform, context.repoRoot, dirs.pack);
    return existsSync(tarball) ? [] : [`${tarball} does not exist`];
  });
  await step(log, `check the tarball (${path.basename(tarball)})`, () => tarballProblems(readFileSync(tarball), version));

  let before = new Map<string, string>();
  await step(log, "seed the fixture home", () => {
    createFixtureHome(dirs.home);
    before = snapshotTree(dirs.home);
    return [];
  });

  await step(log, "npm install --ignore-scripts <tarball>, with no registry", async () => {
    const install = await runToEnd(invocation(platform, "npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball]), {
      cwd: dirs.project,
      env: context.env,
      timeoutMs: 5 * MINUTE,
    });
    writeFileSync(path.join(context.outDir, "npm-install.log"), `${install.stdout}\n${install.stderr}`);
    return exitProblems("npm install", install.code);
  });

  for (const [flag, expected] of [
    ["--version", `${version}\n`],
    ["--help", usageText()],
  ] as const) {
    await step(log, `npx --yes --package=<tarball> agent-cost-analyzer ${flag}`, async () => {
      const run = await runToEnd(invocation(platform, "npx", ["--yes", `--package=${tarball}`, "agent-cost-analyzer", flag]), {
        cwd: dirs.npx,
        env: context.env,
        timeoutMs: 5 * MINUTE,
      });
      return [
        ...exitProblems(`npx ... ${flag}`, run.code),
        ...(run.stdout === expected ? [] : [`npx ... ${flag} printed ${JSON.stringify(run.stdout)}, expected ${JSON.stringify(expected)}`]),
        ...warningProblems(`npx ... ${flag}`, run.stderr),
      ];
    });
  }

  await step(log, "agent-cost-analyzer --no-open --port 0: HTTP checks, the Playwright load spec, Ctrl+C", () => serveChecks(context, log));
  await step(log, "agent-cost-analyzer mcp: initialize, tools/list, resources/list, JSON-RPC alone on stdout", () => mcpChecks(context, log));

  await step(log, "agent-cost-analyser (the alias): tarball, install with the main tarball, --version, --help, mcp initialize", async () => { // codespell:ignore analyser
    const aliasTarball = aliasOption ?? (await packWorkspace(platform, context.repoRoot, "packages/cli-alias", dirs.pack));
    if (!existsSync(aliasTarball)) return [`${aliasTarball} does not exist`];
    return aliasProblems({
      platform,
      project: dirs.alias,
      env: context.env,
      mainTarball: tarball,
      aliasTarball,
      version,
      aliasVersion: context.aliasVersion,
      timeoutMs: 5 * MINUTE,
    });
  });

  await step(log, "the fixture home changed only inside the app's settings folder", () => {
    const allowed = appSettingsDirIn(dirs.home, platform);
    const changes = treeChanges(before, snapshotTree(dirs.home));
    for (const change of changes) log(`  ${change.kind} ${change.path}`);
    return changesOutside(changes, allowed).map((change) => `${change.kind} outside ${allowed}: ${change.path}`);
  });
}

/** Runs the smoke; resolves to the process exit code. */
export async function runSmoke(options: SmokeOptions): Promise<number> {
  const platform = options.platform ?? process.platform;
  rmSync(options.outDir, { recursive: true, force: true });
  mkdirSync(options.outDir, { recursive: true });
  const log = logger(options.outDir);
  const temp = mkdtempSync(path.join(tmpdir(), "aca-npm-smoke-"));
  const dirs = {
    pack: path.join(temp, "pack"),
    home: path.join(temp, "home"),
    npmCache: path.join(temp, "npm-cache"),
    project: path.join(temp, "project"),
    npx: path.join(temp, "npx"),
    alias: path.join(temp, "alias"),
  };
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
  for (const dir of [dirs.project, dirs.alias]) writeFileSync(path.join(dir, "package.json"), `${JSON.stringify({ name: "npm-package-smoke", private: true }, null, 2)}\n`);
  const context: Context = {
    platform,
    repoRoot: options.repoRoot,
    outDir: options.outDir,
    version: (JSON.parse(readFileSync(path.join(options.repoRoot, "packages", "cli", "package.json"), "utf8")) as { version: string }).version,
    aliasVersion: (JSON.parse(readFileSync(path.join(options.repoRoot, "packages", "cli-alias", "package.json"), "utf8")) as { version: string }).version,
    dirs,
    env: isolatedEnv(process.env, { home: dirs.home, npmCache: dirs.npmCache, platform }),
    running: [],
  };
  log(`npm-package smoke: agent-cost-analyzer ${context.version}, Node ${process.version}, ${platform}; temp ${temp}`);

  let code = 0;
  try {
    await smoke(context, options.tarball, options.aliasTarball, log);
    log("npm-package smoke passed");
  } catch (error) {
    code = 1;
    if (!(error instanceof StepFailed)) log(`  FAIL ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    log("npm-package smoke failed");
    const npmLogs = path.join(dirs.npmCache, "_logs");
    if (existsSync(npmLogs)) cpSync(npmLogs, path.join(options.outDir, "npm-logs"), { recursive: true });
  } finally {
    for (const running of context.running) await kill(running);
    if (options.keepTemp) log(`kept ${temp}`);
    else rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
  return code;
}
