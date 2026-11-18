// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The real-client check's sandbox (mcp-client-setup.md §7 item 7, MC8): a
// fresh temporary root with its own HOME, a PATH that puts a recording shim
// in front of each real client program and a stand-in `npx` that runs the
// locally built bin, so `claude mcp get` starts our server without npm or
// the network. Linux only (D13).
import { accessSync, constants, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runToEnd, type Finished } from "../smoke/io.mts";
import { setupSmokeEnv, stubScript, writeStub } from "../smoke/setup-home.mts";
import { parseShimLog, sandboxEnvProblems, shimScript, stripClientVariables, type ShimCall } from "./checks.mts";

export type RealTool = "claude" | "code" | "code-insiders" | "codex" | "gemini";

const STUB_MODULE = pathToFileURL(path.join(import.meta.dirname, "..", "smoke", "client-stubs.mts")).href;
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const BIN = path.join(REPO_ROOT, "packages", "cli", "bin", "agent-cost-analyzer.js");
const MINUTE = 60_000;

export const cliVersion = (): string => (JSON.parse(readFileSync(path.join(REPO_ROOT, "packages", "cli", "package.json"), "utf8")) as { version: string }).version;

/** The first executable called `name` on `PATH`, or undefined. */
export function onPath(name: string, searchPath: string | undefined = process.env.PATH): string | undefined {
  for (const dir of (searchPath ?? "").split(path.delimiter).filter(Boolean)) {
    const file = path.join(dir, name);
    try {
      accessSync(file, constants.X_OK);
      return file;
    } catch {
      // not in this folder
    }
  }
  return undefined;
}

/** What is installed on this machine, found on the owner's real PATH before any sandbox exists. */
export function realTools(): Record<RealTool, string | undefined> {
  return {
    claude: onPath("claude"),
    code: onPath("code"),
    "code-insiders": onPath("code-insiders"),
    codex: onPath("codex"),
    gemini: onPath("gemini"),
  };
}

export interface Sandbox {
  root: string;
  home: string;
  /** A project folder (a real path, as Claude Code's local scope keys it). */
  project: string;
  env: Record<string, string>;
  /** Runs `agent-cost-analyzer <args>` from the built bin. */
  aca(args: readonly string[], cwd?: string): Promise<Finished>;
  /** Runs a shimmed real client, with the sandbox's environment. */
  client(tool: RealTool, args: readonly string[], cwd?: string, timeoutMs?: number): Promise<Finished>;
  /** The shim's calls so far (every real client run by us or by the CLI). */
  calls(tool: RealTool): ShimCall[];
  callLines(tool: RealTool): string[];
  npxCalls(): string[];
}

const readLines = (file: string): string[] => {
  try {
    return readFileSync(file, "utf8").split("\n").filter((line) => line !== "");
  } catch {
    return [];
  }
};

/** A fresh sandbox. `tools` are the real programs (from `realTools()`) to put behind recording shims. */
export function createSandbox(tools: Partial<Record<RealTool, string>>): Sandbox {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "mcp-real-clients-")));
  const home = path.join(root, "home");
  const project = path.join(root, "project");
  const shims = path.join(root, "shims");
  const logs = path.join(root, "logs");
  for (const dir of [path.join(home, ".config"), project, logs]) mkdirSync(dir, { recursive: true });
  for (const [tool, real] of Object.entries(tools)) {
    if (real !== undefined) writeStub(shims, tool, shimScript(process.execPath, real, path.join(logs, `${tool}.jsonl`)));
  }
  const npxLog = path.join(logs, "npx.log");
  writeFileSync(npxLog, "");
  const npx = { logFile: npxLog, bin: BIN, version: cliVersion() };
  writeStub(path.join(root, "npx-stub"), "npx", stubScript(process.execPath, STUB_MODULE, `npxStubMain(${JSON.stringify(npx)})`));

  const env = stripClientVariables(
    setupSmokeEnv(process.env, { home, npmCache: path.join(root, "npm-cache"), pathFirst: [path.join(root, "npx-stub"), shims] }),
  );
  // A display would let a real code open a window in the owner's session.
  delete env.DISPLAY;
  delete env.WAYLAND_DISPLAY;
  const problems = sandboxEnvProblems(env, root);
  if (problems.length > 0) throw new Error(`the sandbox environment is not isolated:\n${problems.join("\n")}`);

  const run = (command: string, args: readonly string[], cwd: string, timeoutMs = 2 * MINUTE) => runToEnd({ command, args: [...args] }, { cwd, env, timeoutMs });
  return {
    root,
    home,
    project,
    env,
    aca: (args, cwd = project) => run(process.execPath, [BIN, ...args], cwd),
    client: (tool, args, cwd = project, timeoutMs) => run(path.join(shims, tool), args, cwd, timeoutMs),
    calls: (tool) => parseShimLog(readLines(path.join(logs, `${tool}.jsonl`))),
    callLines: (tool) => readLines(path.join(logs, `${tool}.jsonl`)),
    npxCalls: () => readLines(npxLog),
  };
}
