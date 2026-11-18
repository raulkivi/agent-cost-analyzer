// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The mcp-setup smoke's checks (mcp-client-setup.md §7, MC7): pure, each
// returning the problems it found, so a step fails with every reason at once.
import { isDeepStrictEqual } from "node:util";
import { clientSetup, type McpClientId } from "../../server/src/mcp/client-setup/client-setup.js";
import type { TreeChange } from "./home.mts";

/** Each client's label, as `mcp status` prints it. */
export const CLIENT_LABELS: Readonly<Record<McpClientId, string>> = {
  "claude-code": "Claude Code",
  "claude-desktop": "Claude Desktop",
  cursor: "Cursor",
  vscode: "VS Code",
  codex: "Codex CLI",
  gemini: "Gemini CLI",
};

/** `mcp status` output as label → status text. */
export function parseStatus(stdout: string): Record<string, string> {
  const lines = stdout.split("\n").filter((line) => line.trim() !== "");
  // Labels hold single spaces ("Claude Code"); the padding before the status has two or more.
  return Object.fromEntries(lines.map((line) => /^(.*?\S)\s{2,}(.*)$/.exec(line)?.slice(1, 3) ?? [line, ""]));
}

export function statusProblems(stdout: string, expected: Readonly<Record<string, string>>): string[] {
  const actual = parseStatus(stdout);
  const wrong = Object.entries(expected).flatMap(([label, want]) => {
    const have = actual[label];
    if (have === undefined) return [`${label}: missing, expected ${JSON.stringify(want)}`];
    return have === want ? [] : [`${label}: ${JSON.stringify(have)}, expected ${JSON.stringify(want)}`];
  });
  const extra = Object.entries(actual)
    .filter(([label]) => !(label in expected))
    .map(([label, have]) => `${label}: unexpected line ${JSON.stringify(have)}`);
  return [...wrong, ...extra];
}

/** The user-scope add and remove argv MC1 builds for a CLI client, without the program name. */
export function expectedArgv(client: "claude-code" | "gemini" | "codex", version: string): { add: string[]; remove?: string[] } {
  const setup = clientSetup(client, { version, pin: false, projectBillingDetails: false, platform: "linux", scope: "user" });
  return {
    add: (setup.command ?? []).slice(1),
    ...(setup.remove === undefined ? {} : { remove: setup.remove.slice(1) }),
  };
}

/** Compares a stub's JSON-lines argv log (undefined: never called) with the calls expected, in order. */
export function argvLogProblems(tool: string, log: string | undefined, expected: readonly (readonly string[])[]): string[] {
  const calls = (log ?? "")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as string[]);
  const problems: string[] = [];
  for (let i = 0; i < Math.max(calls.length, expected.length); i++) {
    const call = calls[i];
    const want = expected[i];
    if (call === undefined) problems.push(`${tool} stub: call ${i + 1} missing, expected ${JSON.stringify(want)}`);
    else if (want === undefined) problems.push(`${tool} stub: unexpected call ${i + 1} ${JSON.stringify(call)}`);
    else if (!isDeepStrictEqual(call, want)) problems.push(`${tool} stub: call ${i + 1} was ${JSON.stringify(call)}, expected ${JSON.stringify(want)}`);
  }
  return problems;
}

type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

function entryAt(config: unknown, keyPath: readonly string[], name: string): unknown {
  const holder = keyPath.reduce<unknown>((node, key) => (isObject(node) ? node[key] : undefined), config);
  return isObject(holder) ? holder[name] : undefined;
}

/** A copy of `config` without `name` at `keyPath`; every other key keeps its place. */
export function withoutEntry(config: unknown, keyPath: readonly string[], name: string): unknown {
  if (!isObject(config)) return config;
  const [key, ...rest] = keyPath;
  if (key === undefined) return Object.fromEntries(Object.entries(config).filter(([k]) => k !== name));
  return Object.fromEntries(Object.entries(config).map(([k, v]) => [k, k === key ? withoutEntry(v, rest, name) : v]));
}

export interface JsonInstallFacts {
  label: string;
  keyPath: readonly string[];
  /** The entry MC1 builds for this client. */
  entry: unknown;
  seeded: string;
  written: string;
  /** The backup file's text; undefined when there is none. */
  backup: string | undefined;
}

const SERVER_NAME = "agent-cost-analyzer";

/** The written file holds the expected entry, everything else as seeded (order included), and the backup is the seeded bytes. */
export function jsonInstallProblems(facts: JsonInstallFacts): string[] {
  const { label, keyPath } = facts;
  let written: unknown;
  try {
    written = JSON.parse(facts.written);
  } catch {
    return [`${label}: the written file is not JSON`];
  }
  const entry = entryAt(written, keyPath, SERVER_NAME);
  const rest = JSON.stringify(withoutEntry(written, keyPath, SERVER_NAME));
  const seeded = JSON.stringify(JSON.parse(facts.seeded));
  return [
    ...(isDeepStrictEqual(entry, facts.entry) ? [] : [`${label}: the entry is ${JSON.stringify(entry)}, expected ${JSON.stringify(facts.entry)}`]),
    ...(rest === seeded ? [] : [`${label}: the rest of the file changed: ${rest}, expected ${seeded}`]),
    ...(facts.backup === undefined ? [`${label}: no backup`] : facts.backup === facts.seeded ? [] : [`${label}: the backup differs from the seeded file`]),
  ];
}

/** Every home change outside `allowed` (relative paths, "/" separators). */
export function homeChangeProblems(changes: readonly TreeChange[], allowed: readonly string[]): string[] {
  return changes.filter((change) => !allowed.includes(change.path)).map((change) => `${change.kind} outside the client config files: ${change.path}`);
}
