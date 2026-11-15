// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// How the npm-package smoke runs npm, npx and the installed bin on each OS,
// how it stops the server, and the environment they all get (npm-package.md
// §4.8 steps 3-7).
import path from "node:path";
import { fixtureHomeEnv } from "./home.mts";

export interface Invocation {
  command: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
}

// What cmd.exe passes through unquoted; anything else is quoted.
const PLAIN = /^[\w\-.:\\/=@+,]+$/;
// What cmd.exe would expand or split even inside quotes.
const UNSAFE = /["%!\r\n]/;

function quoteForCmd(arg: string): string {
  if (UNSAFE.test(arg)) throw new Error(`cmd.exe cannot pass ${JSON.stringify(arg)} safely`);
  return PLAIN.test(arg) ? arg : `"${arg}"`;
}

/**
 * The program and arguments for spawn, with no shell on macOS and Linux. On
 * Windows npm, npx and the bin are .cmd files, which only cmd.exe runs; the
 * line is built here, as Node's own `shell: true` would, with each
 * argument quoted.
 */
export function invocation(platform: NodeJS.Platform, command: string, args: readonly string[]): Invocation {
  if (platform !== "win32") return { command, args: [...args] };
  const line = [command, ...args].map(quoteForCmd).join(" ");
  return { command: "cmd.exe", args: ["/d", "/s", "/c", `"${line}"`], windowsVerbatimArguments: true };
}

/** The bin npm links for `agent-cost-analyzer` in a project that installed it. */
export function installedBin(platform: NodeJS.Platform, projectDir: string): string {
  const bin = (platform === "win32" ? path.win32 : path.posix).join(projectDir, "node_modules", ".bin", "agent-cost-analyzer");
  return platform === "win32" ? `${bin}.cmd` : bin;
}

export type StopAction = { kind: "signal"; signal: "SIGINT" } | { kind: "command"; invocation: Invocation };

/**
 * Ctrl+C for the server: SIGINT on macOS and Linux. Windows has no SIGINT
 * for another process and the bin runs under cmd.exe, so the whole process
 * tree is killed.
 */
export function stopAction(platform: NodeJS.Platform, pid: number): StopAction {
  return platform === "win32"
    ? { kind: "command", invocation: { command: "taskkill", args: ["/pid", String(pid), "/T", "/F"] } }
    : { kind: "signal", signal: "SIGINT" };
}

/** Nothing listens on the discard port, so a registry fetch fails at once instead of reaching the network. */
export const DEAD_REGISTRY = "http://127.0.0.1:9/";

// Variables that would point the app, a log provider or npm outside the
// smoke's folders, or run the package under something other than plain Node.
const DROPPED = [
  /^npm_/i,
  /^(HOME|USERPROFILE|APPDATA|LOCALAPPDATA|XDG_\w+|COPILOT_HOME|CLAUDE_CONFIG_DIR|PI_CODING_AGENT_DIR|NODE_OPTIONS)$/i,
  /^AGENT_COST_ANALYZER_/i,
];

/**
 * The environment for npm, npx and the package: the caller's, with the home
 * and settings folders in the fixture home, npm's cache in its own folder,
 * and npm kept off the network (no registry, update check, audit or fund).
 * npm's own `npm_*` variables from `npm run` are dropped.
 */
export function isolatedEnv(
  base: Readonly<Record<string, string | undefined>>,
  options: { home: string; npmCache: string; platform: NodeJS.Platform },
): Record<string, string> {
  const kept = Object.entries(base).filter(
    (entry): entry is [string, string] => entry[1] !== undefined && !DROPPED.some((pattern) => pattern.test(entry[0])),
  );
  return {
    ...Object.fromEntries(kept),
    ...fixtureHomeEnv(options.home, options.platform),
    npm_config_cache: options.npmCache,
    npm_config_registry: DEAD_REGISTRY,
    npm_config_update_notifier: "false",
    npm_config_audit: "false",
    npm_config_fund: "false",
  };
}
