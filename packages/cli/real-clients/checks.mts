// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The pure parts of the real-client check (mcp-client-setup.md §7 item 7,
// MC8): the guard, the hash comparison of the owner's real configs, the
// recording shim around each real client program, and the parsing of what
// the real programs print. Node runs this file directly (type stripping), so
// it holds only erasable syntax.
import { createHash } from "node:crypto";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

/** The check runs real client programs, so it is opt-in, like REAL_DATA. */
export const realClientsEnabled = (env: Readonly<Record<string, string | undefined>>): boolean => env.REAL_CLIENTS === "1";

/**
 * The owner's real configs a mistake could hit. ~/.claude.json is left out:
 * any running Claude Code session writes it, so a hash would change without
 * this check's doing; the shim log proves every claude call used the
 * temporary home instead.
 */
export function guardedFiles(home: string): string[] {
  return [
    ".config/Claude/claude_desktop_config.json",
    ".cursor/mcp.json",
    ".config/Code/User/mcp.json",
    ".codex/config.toml",
    ".gemini/settings.json",
  ].map((relative) => path.posix.join(home, relative));
}

export type FileHashes = Record<string, string>;

/** sha256 of each file's bytes, or "absent". `read` returns undefined for a file that is not there. */
export function hashFiles(files: readonly string[], read: (file: string) => string | Buffer | undefined): FileHashes {
  return Object.fromEntries(
    files.map((file) => {
      const content = read(file);
      return [file, content === undefined ? "absent" : createHash("sha256").update(content).digest("hex")];
    }),
  );
}

export function hashChanges(before: FileHashes, after: FileHashes): string[] {
  return Object.keys(before).flatMap((file) => {
    if (before[file] === after[file]) return [];
    if (after[file] === "absent") return [`${file} was deleted`];
    if (before[file] === "absent") return [`${file} was created`];
    return [`${file} changed`];
  });
}

/**
 * A node script that stands in front of a real client program: it records
 * HOME, the working directory and argv, then runs the real program with the
 * same stdio. The log is the evidence that no call reached the owner's home.
 */
export function shimScript(node: string, real: string, logFile: string): string {
  return [
    `#!${node}`,
    "// A recording shim in front of the real client (packages/cli/real-clients/checks.mts).",
    'const { appendFileSync } = require("node:fs");',
    'const { spawnSync } = require("node:child_process");',
    "const argv = process.argv.slice(2);",
    `appendFileSync(${JSON.stringify(logFile)}, JSON.stringify({ home: process.env.HOME, cwd: process.cwd(), argv }) + "\\n");`,
    `const run = spawnSync(${JSON.stringify(real)}, argv, { stdio: "inherit" });`,
    "process.exit(run.status === null ? 128 : run.status);",
    "",
  ].join("\n");
}

export interface ShimCall {
  home: string | undefined;
  cwd: string;
  argv: string[];
}

export const parseShimLog = (lines: readonly string[]): ShimCall[] => lines.filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as ShimCall);

export function shimCallProblems(tool: string, lines: readonly string[], tempHome: string, options: { requireCalls?: boolean } = {}): string[] {
  const calls = parseShimLog(lines);
  if (calls.length === 0 && options.requireCalls === true) return [`${tool} was never called`];
  return calls.filter((call) => call.home !== tempHome).map((call) => `${tool} ran with HOME=${call.home ?? "(unset)"}, not the temporary home: ${call.argv.join(" ")}`);
}

/** What `mcp status` prints in a client's row (its label, spaces, the state), or undefined. */
export function statusRow(output: string, label: string): string | undefined {
  const prefix = `${label} `;
  const line = output.split("\n").find((candidate) => candidate.startsWith(prefix));
  return line?.slice(prefix.length).trim();
}

/** The `Status:` line of `claude mcp get <name>`. */
export function claudeGetStatus(output: string): "connected" | "failed" | "unknown" | `other: ${string}` {
  const line = /^\s*Status:\s*(.+?)\s*$/m.exec(output)?.[1];
  if (line === undefined) return "unknown";
  if (/connected/i.test(line) && !/fail|not/i.test(line)) return "connected";
  if (/fail/i.test(line)) return "failed";
  return `other: ${line}`;
}

export interface WrittenVscodeConfig {
  /** Relative to the profile folder (Code's user-data directory, or ~/.config/Code). */
  file: string;
  entry: unknown;
}

/** Our install against what the real `code --add-mcp` writes: same relative path, same `servers` entry. */
export function vscodeEntryProblems(ours: WrittenVscodeConfig, real: WrittenVscodeConfig): string[] {
  return [
    ...(ours.file === real.file ? [] : [`relative path: ours ${ours.file}, the real client's ${real.file}`]),
    ...(isDeepStrictEqual(ours.entry, real.entry) ? [] : [`entry differs: ours ${JSON.stringify(ours.entry)}, the real client's ${JSON.stringify(real.entry)}`]),
  ];
}

// Variables that would make a real client talk to a running app (VS Code's
// IPC hook opens files in the owner's window) or read another profile.
const CLIENT_VARIABLES = /^(VSCODE_\w+|CLAUDE\w*|ANTHROPIC_\w+|ELECTRON_\w+)$/;

export function stripClientVariables(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined && !CLIENT_VARIABLES.test(entry[0])));
}

const HOME_VARIABLES = ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME", "CODEX_HOME", "APPDATA", "LOCALAPPDATA", "USERPROFILE"];

/** Every home-like variable that is set must point inside the temporary root; HOME must be set. */
export function sandboxEnvProblems(env: Readonly<Record<string, string | undefined>>, root: string): string[] {
  const inside = (value: string) => value === root || value.startsWith(`${root}${path.sep}`);
  const problems = HOME_VARIABLES.flatMap((name) => {
    const value = env[name];
    return value === undefined || inside(value) ? [] : [`${name} is ${value}, outside ${root}`];
  });
  return env.HOME === undefined ? ["HOME is not set", ...problems] : problems;
}

/** The temporary root's random part, replaced, so output can be pasted into a public PR. */
export const redactTemp = (text: string, root: string): string => text.split(root).join("<tmp>");

export interface SummaryRow {
  client: string;
  scope: string;
  result: string;
}

/** A fixed-width table of what each check did. */
export function summaryTable(rows: readonly SummaryRow[]): string {
  const widths = (["client", "scope", "result"] as const).map((key) => Math.max(key.length, ...rows.map((row) => row[key].length)));
  const line = (cells: readonly string[]) => cells.map((cell, i) => cell.padEnd(widths[i]!)).join("  ").trimEnd();
  return [line(["client", "scope", "result"]), line(widths.map((w) => "-".repeat(w))), ...rows.map((row) => line([row.client, row.scope, row.result]))].join("\n");
}
