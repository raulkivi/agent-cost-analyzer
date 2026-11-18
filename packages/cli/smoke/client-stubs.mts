// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Stand-ins for the claude, gemini and codex CLIs and for npx, which the
// mcp-setup smoke puts first on PATH (mcp-client-setup.md §7, MC7). They
// are not the real CLIs: each accepts only the argv `mcp install` and
// `mcp uninstall` build, records it, and makes the config-file change the
// real CLI makes, in the format MC0 recorded (§3.2), so `mcp status` and
// `mcp uninstall` can be checked end to end. Node runs this file directly
// (type stripping), so it holds only erasable syntax and node: imports.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export type StubTool = "claude" | "gemini" | "codex";

/** What a stub run does: its exit code, its stderr, and the config file's new text (absent: no write). */
export interface StubResult {
  code: number;
  stderr: string;
  text: string | undefined;
}

const PACKAGE = "agent-cost-analyzer";

/** The file each real CLI keeps its user-scope servers in. */
export function stubConfigFile(tool: StubTool, home: string): string {
  switch (tool) {
    case "claude":
      return path.posix.join(home, ".claude.json");
    case "gemini":
      return path.posix.join(home, ".gemini", "settings.json");
    case "codex":
      return path.posix.join(home, ".codex", "config.toml");
  }
}

const ok = (text: string): StubResult => ({ code: 0, stderr: "", text });
const failed = (stderr: string): StubResult => ({ code: 1, stderr, text: undefined });
const unsupported = (tool: StubTool, args: readonly string[]): StubResult => ({
  code: 2,
  stderr: `${tool} stub: unsupported arguments ${JSON.stringify(args)}\n`,
  text: undefined,
});

type JsonObject = Record<string, unknown>;

const asObject = (value: unknown): JsonObject => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : {});

const readJson = (text: string | undefined): JsonObject => asObject(text === undefined || text.trim() === "" ? {} : JSON.parse(text));

// Both CLIs write 2-space JSON with a final newline.
const jsonText = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** Adds or removes `name` under the top-level `mcpServers`, keeping every other key in order. */
function editServers(current: string | undefined, name: string, entry: unknown, missing: string, exists: string): StubResult {
  const config = readJson(current);
  const servers = asObject(config.mcpServers);
  if (entry === undefined) {
    if (!(name in servers)) return failed(missing);
    delete servers[name];
  } else {
    if (name in servers) return failed(exists);
    servers[name] = entry;
  }
  return ok(jsonText({ ...config, mcpServers: servers }));
}

const same = (args: readonly string[], prefix: readonly string[]) => prefix.every((word, i) => args[i] === word);

// claude mcp add --scope user <name> -- <cmd> [args…] | claude mcp remove --scope user <name>
function claude(args: readonly string[], current: string | undefined): StubResult {
  const name = args[4] ?? "";
  if (same(args, ["mcp", "add", "--scope", "user"]) && args[5] === "--" && args.length > 6) {
    const [command, ...rest] = args.slice(6);
    return editServers(current, name, { type: "stdio", command, args: rest, env: {} }, "", `MCP server ${name} already exists in user config\n`);
  }
  if (same(args, ["mcp", "remove", "--scope", "user"]) && args.length === 5)
    return editServers(current, name, undefined, `No MCP server named "${name}" found in user config\n`, "");
  return unsupported("claude", args);
}

// gemini mcp add -s user <name> <cmd> [args…] | gemini mcp remove -s user <name>
function gemini(args: readonly string[], current: string | undefined): StubResult {
  const name = args[4] ?? "";
  if (same(args, ["mcp", "add", "-s", "user"]) && args.length > 5) {
    const [command, ...rest] = args.slice(5);
    return editServers(current, name, { command, args: rest }, "", `Server "${name}" already exists\n`);
  }
  if (same(args, ["mcp", "remove", "-s", "user"]) && args.length === 5)
    return editServers(current, name, undefined, `Server "${name}" not found in user settings\n`, "");
  return unsupported("gemini", args);
}

// codex mcp add <name> -- <cmd> [args…]; codex documents no remove command.
function codex(args: readonly string[], current: string | undefined): StubResult {
  if (!(same(args, ["mcp", "add"]) && args[3] === "--" && args.length > 4)) return unsupported("codex", args);
  const name = args[2] ?? "";
  const header = `[mcp_servers.${name}]`;
  const text = current ?? "";
  if (text.split(/\r?\n/).some((line) => line.trim() === header)) return failed(`MCP server ${name} already exists\n`);
  const [command, ...rest] = args.slice(4);
  // JSON strings are valid TOML basic strings for every argv the CLI writes.
  const table = `${header}\ncommand = ${JSON.stringify(command)}\nargs = [${rest.map((arg) => JSON.stringify(arg)).join(", ")}]\n`;
  return ok(text === "" ? table : `${text.endsWith("\n") ? text : `${text}\n`}\n${table}`);
}

/** One stub run against the current text of the tool's config file (undefined: no file). Pure. */
export function runClientStub(tool: StubTool, args: readonly string[], current: string | undefined): StubResult {
  switch (tool) {
    case "claude":
      return claude(args, current);
    case "gemini":
      return gemini(args, current);
    case "codex":
      return codex(args, current);
  }
}

export type NpxForward = { ok: true; args: string[] } | { ok: false; message: string };

/**
 * What the npx stand-in passes to the installed bin: the arguments after the
 * package name, when the launch spec is exactly `-y --prefer-offline
 * agent-cost-analyzer[@<version>] mcp …`. Pure.
 */
export function npxForward(args: readonly string[], version: string): NpxForward {
  const [yes, offline, pkg, ...rest] = args;
  const known = pkg === PACKAGE || pkg === `${PACKAGE}@${version}`;
  if (yes === "-y" && offline === "--prefer-offline" && known && rest[0] === "mcp") return { ok: true, args: rest };
  return { ok: false, message: `npx stub: unexpected arguments ${JSON.stringify(args)}` };
}

const record = (logFile: string, args: readonly string[]) => appendFileSync(logFile, `${JSON.stringify(args)}\n`);

/** The stub's process: log argv, apply the change to $HOME's config file, exit as the real CLI would. */
export function clientStubMain(tool: StubTool, logFile: string): void {
  const args = process.argv.slice(2);
  record(logFile, args);
  const file = stubConfigFile(tool, homedir());
  const result = runClientStub(tool, args, existsSync(file) ? readFileSync(file, "utf8") : undefined);
  if (result.text !== undefined) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, result.text);
  }
  process.stderr.write(result.stderr);
  process.exitCode = result.code;
}

/** The npx stand-in's process: log argv, then run the installed bin in its place, on the same stdio. */
export function npxStubMain(options: { logFile: string; bin: string; version: string }): void {
  const args = process.argv.slice(2);
  record(options.logFile, args);
  const forward = npxForward(args, options.version);
  if (!forward.ok) {
    process.stderr.write(`${forward.message}\n`);
    process.exitCode = 2;
    return;
  }
  const child = spawn(options.bin, forward.args, { stdio: "inherit" });
  child.on("error", (error) => {
    process.stderr.write(`npx stub: ${error.message}\n`);
    process.exitCode = 2;
  });
  child.on("close", (code, signal) => {
    process.exitCode = code ?? (signal === null ? 1 : 128);
  });
}
