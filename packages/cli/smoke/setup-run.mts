// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The mcp-setup smoke (mcp-client-setup.md §7 items 1-4, MC7), in order:
// install the packed tarball, then run `agent-cost-analyzer mcp
// config|status|install|uninstall` from it for all six clients against a
// temporary home, with stand-ins for the claude, codex, gemini and npx CLIs
// (client-stubs.mts). Each step gathers facts and hands them to a pure
// check (setup-checks.mts, home.mts); the first step with problems stops the
// run. Linux only (D13).
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { clientSetup, MCP_CLIENT_IDS } from "../../server/src/mcp/client-setup/client-setup.js";
import { configText } from "../src/mcp-setup/config-text.js";
import { BACKUP_SUFFIX } from "../src/mcp-setup/config-file-store.js";
import { expectedMcpSurface, jsonRpcLineProblems, mcpSurfaceProblems } from "./checks.mts";
import { snapshotTree, treeChanges, type TreeSnapshot } from "./home.mts";
import { kill, runToEnd, start, withTimeout, type Finished, type Running } from "./io.mts";
import { RecordingStdioTransport } from "./mcp-transport.mts";
import { installedBin } from "./processes.mts";
import { CLIENT_LABELS, argvLogProblems, expectedArgv, homeChangeProblems, jsonInstallProblems, statusProblems } from "./setup-checks.mts";
import { EXTENSION_FOLDER, SEEDED_CONFIGS, STUB_TOOLS, seedSetupHome, setupSmokeEnv, stubScript, writableInHome, writeStub } from "./setup-home.mts";
import { buildAndPack, exitProblems, logger, MINUTE, step, StepFailed, warningProblems, type Log } from "./steps.mts";
import type { StubTool } from "./client-stubs.mts";

export interface SetupSmokeOptions {
  repoRoot: string;
  /** An already packed tarball; otherwise build and pack. */
  tarball?: string;
  outDir: string;
  keepTemp: boolean;
}

interface Context {
  repoRoot: string;
  outDir: string;
  version: string;
  dirs: { pack: string; home: string; npmCache: string; project: string; stubs: string; npxStub: string; logs: string };
  /** The installed bin's environment: the temporary home, the client stubs first on PATH. */
  env: Record<string, string>;
  bin: string;
  running: Running[];
  log: Log;
}

const SERVER_NAME = "agent-cost-analyzer";
const STUB_MODULE = pathToFileURL(path.join(import.meta.dirname, "client-stubs.mts")).href;
const ALL_WITH = (status: string) => Object.fromEntries(MCP_CLIENT_IDS.map((id) => [CLIENT_LABELS[id], status]));

const stubLog = (context: Context, tool: StubTool | "npx") => path.join(context.dirs.logs, `${tool}.jsonl`);
const readIfThere = (file: string) => (existsSync(file) ? readFileSync(file, "utf8") : undefined);
const inHome = (context: Context, relative: string) => path.join(context.dirs.home, relative);

/** Runs the installed bin with stdin closed (not a TTY), keeping a transcript in commands.log. */
async function cli(context: Context, args: readonly string[]): Promise<Finished> {
  const run = await runToEnd({ command: context.bin, args: [...args] }, { cwd: context.dirs.project, env: context.env, timeoutMs: 2 * MINUTE });
  writeFileSync(path.join(context.outDir, "commands.log"), `$ agent-cost-analyzer ${args.join(" ")}  # exit ${run.code}\n${run.stdout}${run.stderr === "" ? "" : `[stderr]\n${run.stderr}`}\n`, {
    flag: "a",
  });
  return run;
}

const cliProblems = (label: string, run: Finished, expectedCode = 0) => [...exitProblems(label, run.code, expectedCode), ...warningProblems(label, run.stderr)];

const homeUnchanged = (context: Context, before: TreeSnapshot, label: string) =>
  treeChanges(before, snapshotTree(context.dirs.home)).map((change) => `${label} ${change.kind} ${change.path}`);

/** Every stub's argv log, so a step can check that it ran nothing. */
const stubLogs = (context: Context) => Object.fromEntries(STUB_TOOLS.map((tool) => [tool, readIfThere(stubLog(context, tool))]));

const stubLogsUnchanged = (context: Context, before: Record<string, string | undefined>, label: string) =>
  STUB_TOOLS.filter((tool) => readIfThere(stubLog(context, tool)) !== before[tool]).map((tool) => `${label} ran the ${tool} stub`);

/** Nothing written and no client CLI run. */
function nothingDone(context: Context, label: string, run: () => Promise<string[]>): () => Promise<string[]> {
  return async () => {
    const home = snapshotTree(context.dirs.home);
    const logs = stubLogs(context);
    const problems = await run();
    return [...problems, ...homeUnchanged(context, home, label), ...stubLogsUnchanged(context, logs, label)];
  };
}

function writeStubs(context: Context): void {
  for (const tool of STUB_TOOLS) {
    writeStub(context.dirs.stubs, tool, stubScript(process.execPath, STUB_MODULE, `clientStubMain(${JSON.stringify(tool)}, ${JSON.stringify(stubLog(context, tool))})`));
  }
  const npx = { logFile: stubLog(context, "npx"), bin: context.bin, version: context.version };
  writeStub(context.dirs.npxStub, "npx", stubScript(process.execPath, STUB_MODULE, `npxStubMain(${JSON.stringify(npx)})`));
}

function seededChecks(context: Context, installed: boolean): string[] {
  return SEEDED_CONFIGS.flatMap((config) => {
    const label = CLIENT_LABELS[config.client];
    const written = readFileSync(inHome(context, config.file), "utf8");
    if (!installed) return written === config.text ? [] : [`${label}: ${config.file} is not its original bytes`];
    const setup = clientSetup(config.client, { version: context.version, pin: false, projectBillingDetails: false, platform: "linux", scope: "user" });
    return jsonInstallProblems({
      label,
      keyPath: config.keyPath,
      entry: setup.json?.entry,
      seeded: config.text,
      written,
      backup: readIfThere(inHome(context, `${config.file}${BACKUP_SUFFIX}`)),
    });
  });
}

/** Starts a written {command, args} as a client would, with the npx stand-in first on PATH, and lists its tools. */
async function launchProblems(context: Context, label: string, launch: { command: string; args: string[] }): Promise<string[]> {
  const env = { ...context.env, PATH: `${context.dirs.npxStub}${path.delimiter}${context.env.PATH}` };
  const server = start({ command: launch.command, args: launch.args }, { cwd: context.dirs.project, env });
  context.running.push(server);
  const transport = new RecordingStdioTransport(server.child);
  const client = new Client({ name: "mcp-setup-smoke", version: context.version });
  const expected = expectedMcpSurface(
    JSON.parse(readFileSync(path.join(context.repoRoot, "packages", "server", "src", "mcp", "__snapshots__", "tool-list-standalone.json"), "utf8")),
  );
  let actual: { version?: string; tools: string[]; resources: string[] } | undefined;
  try {
    await withTimeout(client.connect(transport), MINUTE, `${label}: MCP initialize`);
    actual = {
      version: client.getServerVersion()?.version,
      tools: (await client.listTools()).tools.map((tool) => tool.name),
      resources: (await client.listResources()).resources.map((resource) => resource.uri),
    };
    context.log(`  ${label}: ${launch.command} ${launch.args.join(" ")} listed ${actual.tools.length} tools`);
  } finally {
    await client.close();
  }
  const code = await withTimeout(server.exited, 30_000, `${label}: the MCP server's exit after stdin closed`);
  writeFileSync(path.join(context.outDir, "launch.stderr.log"), `## ${label}\n${server.stderr()}\n`, { flag: "a" });
  return [
    ...(actual === undefined ? [`${label}: the MCP client read no surface`] : mcpSurfaceProblems(expected, actual, context.version).map((p) => `${label}: ${p}`)),
    ...jsonRpcLineProblems(transport.lines).map((p) => `${label}: ${p}`),
    ...exitProblems(`${label}: the launched server, after stdin closed,`, code),
  ];
}

const mtimes = (context: Context) =>
  Object.fromEntries(writableInHome().flatMap((file) => (existsSync(inHome(context, file)) ? [[file, statSync(inHome(context, file)).mtimeMs]] : [])));

async function smoke(context: Context, tarballOption: string | undefined): Promise<void> {
  const { dirs, log, version } = context;
  let tarball = tarballOption ?? "";
  await step(log, tarballOption === undefined ? "build and pack (npm run build, npm pack)" : `use ${tarballOption}`, async () => {
    if (tarballOption === undefined) tarball = await buildAndPack("linux", context.repoRoot, dirs.pack);
    return existsSync(tarball) ? [] : [`${tarball} does not exist`];
  });

  await step(log, "npm install --ignore-scripts <tarball>, with no registry", async () => {
    const install = await runToEnd({ command: "npm", args: ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball] }, { cwd: dirs.project, env: context.env, timeoutMs: 5 * MINUTE });
    writeFileSync(path.join(context.outDir, "npm-install.log"), `${install.stdout}\n${install.stderr}`);
    return exitProblems("npm install", install.code);
  });

  let seeded: TreeSnapshot = new Map();
  await step(log, "seed the home: client folders, three JSON configs, claude, codex and gemini stubs first on PATH", () => {
    seedSetupHome(dirs.home);
    writeStubs(context);
    seeded = snapshotTree(dirs.home);
    return [];
  });

  await step(log, "mcp status: every client not registered", nothingDone(context, "mcp status", async () => {
    const run = await cli(context, ["mcp", "status"]);
    return [...cliProblems("mcp status", run), ...statusProblems(run.stdout, ALL_WITH("not registered"))];
  }));

  await step(log, "mcp config --client <id>: the hand-registration text for each client", nothingDone(context, "mcp config", async () => {
    const problems: string[] = [];
    for (const id of MCP_CLIENT_IDS) {
      const run = await cli(context, ["mcp", "config", "--client", id]);
      const expected = `${CLIENT_LABELS[id]} (user scope)\n\n${configText(clientSetup(id, { version, pin: false, projectBillingDetails: false, platform: "linux", scope: "user" }))}\n`;
      problems.push(...cliProblems(`mcp config --client ${id}`, run), ...(run.stdout === expected ? [] : [`mcp config --client ${id} printed ${JSON.stringify(run.stdout)}, expected ${JSON.stringify(expected)}`]));
    }
    return problems;
  }));

  await step(log, "mcp install --client all --dry-run: prints the plan, changes nothing", nothingDone(context, "--dry-run", async () => {
    const run = await cli(context, ["mcp", "install", "--client", "all", "--dry-run"]);
    return [...cliProblems("mcp install --dry-run", run), ...(run.stdout.includes("Dry run: nothing was changed.") ? [] : ["mcp install --dry-run did not say it was a dry run"])];
  }));

  await step(log, "mcp install --client all, without --yes and without a terminal: refuses", nothingDone(context, "install without --yes", async () => {
    const run = await cli(context, ["mcp", "install", "--client", "all"]);
    return [...cliProblems("mcp install without --yes", run, 1), ...(run.stderr.includes("Pass --yes to apply") ? [] : [`mcp install without --yes printed ${JSON.stringify(run.stderr)} on stderr`])];
  }));

  const argv = { claude: expectedArgv("claude-code", version), gemini: expectedArgv("gemini", version), codex: expectedArgv("codex", version) };
  await step(log, "mcp install --client all --yes: JSON entries merged with backups, claude/codex/gemini add argv, status registered", async () => {
    const run = await cli(context, ["mcp", "install", "--client", "all", "--yes"]);
    const status = await cli(context, ["mcp", "status"]);
    return [
      ...cliProblems("mcp install --yes", run),
      ...seededChecks(context, true),
      ...argvLogProblems("claude", readIfThere(stubLog(context, "claude")), [argv.claude.add]),
      ...argvLogProblems("gemini", readIfThere(stubLog(context, "gemini")), [argv.gemini.add]),
      ...argvLogProblems("codex", readIfThere(stubLog(context, "codex")), [argv.codex.add]),
      ...cliProblems("mcp status", status),
      ...statusProblems(status.stdout, ALL_WITH("registered (latest)")),
    ];
  });

  await step(log, "launch each JSON client's written command (npx stand-in → the installed bin): tools/list", async () => {
    const problems: string[] = [];
    const launches: string[][] = [];
    for (const config of SEEDED_CONFIGS) {
      const holder = config.keyPath.reduce<Record<string, unknown>>((node, key) => node[key] as Record<string, unknown>, JSON.parse(readFileSync(inHome(context, config.file), "utf8")));
      const entry = holder[SERVER_NAME] as { command: string; args: string[] };
      launches.push(entry.args);
      problems.push(...(await launchProblems(context, CLIENT_LABELS[config.client], entry)));
    }
    return [...problems, ...argvLogProblems("npx", readIfThere(stubLog(context, "npx")), launches)];
  });

  await step(log, "mcp install --client all --yes again: already registered, no write, no CLI run", async () => {
    const times = mtimes(context);
    const check = nothingDone(context, "the second install", async () => {
      const run = await cli(context, ["mcp", "install", "--client", "all", "--yes"]);
      const already = MCP_CLIENT_IDS.filter((id) => !run.stdout.includes(`${CLIENT_LABELS[id]} (user scope): already registered`)).map((id) => `${CLIENT_LABELS[id]} not reported as already registered`);
      return [...cliProblems("the second mcp install", run), ...already, ...(run.stdout.includes("Nothing to change.") ? [] : ["the second mcp install did not say there was nothing to change"])];
    });
    const problems = await check();
    const touched = Object.entries(mtimes(context))
      .filter(([file, time]) => times[file] !== time)
      .map(([file]) => `the second install touched ${file}`);
    return [...problems, ...touched];
  });

  await step(log, "mcp uninstall --client all --dry-run: changes nothing", nothingDone(context, "uninstall --dry-run", async () => {
    const run = await cli(context, ["mcp", "uninstall", "--client", "all", "--dry-run"]);
    return [...cliProblems("mcp uninstall --dry-run", run), ...(run.stdout.includes("Dry run: nothing was changed.") ? [] : ["mcp uninstall --dry-run did not say it was a dry run"])];
  }));

  await step(log, "mcp uninstall --client all --yes: seeded files back to their bytes, remove argv, Codex note, status", async () => {
    const codexConfig = readIfThere(inHome(context, ".codex/config.toml"));
    const run = await cli(context, ["mcp", "uninstall", "--client", "all", "--yes"]);
    const status = await cli(context, ["mcp", "status"]);
    const toml = clientSetup("codex", { version, pin: false, projectBillingDetails: false, platform: "linux", scope: "user" }).toml?.trimEnd() ?? "";
    return [
      ...cliProblems("mcp uninstall --yes", run),
      ...seededChecks(context, false),
      ...argvLogProblems("claude", readIfThere(stubLog(context, "claude")), [argv.claude.add, argv.claude.remove ?? []]),
      ...argvLogProblems("gemini", readIfThere(stubLog(context, "gemini")), [argv.gemini.add, argv.gemini.remove ?? []]),
      ...argvLogProblems("codex", readIfThere(stubLog(context, "codex")), [argv.codex.add]),
      ...(run.stdout.includes(`Codex has no remove command. Delete this table from ${inHome(context, ".codex/config.toml")}:\n${toml}`) ? [] : ["mcp uninstall did not print the Codex table to delete"]),
      ...(readIfThere(inHome(context, ".codex/config.toml")) === codexConfig ? [] : ["mcp uninstall changed ~/.codex/config.toml"]),
      ...cliProblems("mcp status", status),
      // Codex has no remove command, so it stays registered until the user deletes the table.
      ...statusProblems(status.stdout, { ...ALL_WITH("not registered"), [CLIENT_LABELS.codex]: "registered (latest)" }),
    ];
  });

  await step(log, "the home changed only in the client config files, their backups and the stubs' files", () => {
    const changes = treeChanges(seeded, snapshotTree(dirs.home));
    for (const change of changes) log(`  ${change.kind} ${change.path}`);
    return homeChangeProblems(changes, writableInHome());
  });

  await step(log, `VS Code with ${EXTENSION_FOLDER}: provided by the extension, install plans nothing`, async () => {
    mkdirSync(inHome(context, EXTENSION_FOLDER), { recursive: true });
    return nothingDone(context, "VS Code with the extension", async () => {
      const status = await cli(context, ["mcp", "status"]);
      const install = await cli(context, ["mcp", "install", "--client", "vscode", "--yes"]);
      return [
        ...cliProblems("mcp status", status),
        ...statusProblems(status.stdout, {
          ...ALL_WITH("not registered"),
          [CLIENT_LABELS.codex]: "registered (latest)",
          [CLIENT_LABELS.vscode]: "provided by the AI Credits Analyzer extension",
        }),
        ...cliProblems("mcp install --client vscode", install),
        ...(install.stdout.includes("Nothing to change.") ? [] : [`mcp install --client vscode printed ${JSON.stringify(install.stdout)}`]),
      ];
    })();
  });
}

/** Runs the smoke; resolves to the process exit code. */
export async function runSetupSmoke(options: SetupSmokeOptions): Promise<number> {
  rmSync(options.outDir, { recursive: true, force: true });
  mkdirSync(options.outDir, { recursive: true });
  const log = logger(options.outDir);
  const temp = mkdtempSync(path.join(tmpdir(), "aca-mcp-setup-smoke-"));
  const dirs = {
    pack: path.join(temp, "pack"),
    home: path.join(temp, "home"),
    npmCache: path.join(temp, "npm-cache"),
    project: path.join(temp, "project"),
    stubs: path.join(temp, "stubs"),
    npxStub: path.join(temp, "npx-stub"),
    logs: path.join(temp, "stub-logs"),
  };
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dirs.project, "package.json"), `${JSON.stringify({ name: "mcp-setup-smoke", private: true }, null, 2)}\n`);
  const context: Context = {
    repoRoot: options.repoRoot,
    outDir: options.outDir,
    version: (JSON.parse(readFileSync(path.join(options.repoRoot, "packages", "cli", "package.json"), "utf8")) as { version: string }).version,
    dirs,
    env: setupSmokeEnv(process.env, { home: dirs.home, npmCache: dirs.npmCache, pathFirst: [dirs.stubs] }),
    bin: installedBin("linux", dirs.project),
    running: [],
    log,
  };
  log(`mcp-setup smoke: agent-cost-analyzer ${context.version}, Node ${process.version}, ${process.platform}; temp ${temp}`);

  let code = 0;
  try {
    await smoke(context, options.tarball);
    log("mcp-setup smoke passed");
  } catch (error) {
    code = 1;
    if (!(error instanceof StepFailed)) log(`  FAIL ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    log("mcp-setup smoke failed");
    if (existsSync(dirs.logs)) cpSync(dirs.logs, path.join(options.outDir, "stub-logs"), { recursive: true });
  } finally {
    for (const running of context.running) await kill(running);
    if (options.keepTemp) log(`kept ${temp}`);
    else rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
  return code;
}
