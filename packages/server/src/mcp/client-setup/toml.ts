// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

import type { McpLaunchSpec } from "./launch-spec.js";

const ESCAPES: Record<string, string> = {
  "\\": "\\\\",
  '"': '\\"',
  "\n": "\\n",
  "\t": "\\t",
  "\r": "\\r",
  "\b": "\\b",
  "\f": "\\f",
};

/** TOML basic string; every control character is escaped. */
export function tomlString(value: string): string {
  const body = value.replace(
    // eslint-disable-next-line no-control-regex
    /[\\"\u0000-\u001f\u007f]/g,
    (c) => ESCAPES[c] ?? `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  return `"${body}"`;
}

const BARE_KEY = /^[A-Za-z0-9_-]+$/;

/** Text of the Codex `[mcp_servers.<name>]` table, for printing only. */
export function mcpServerToml(name: string, spec: McpLaunchSpec): string {
  const key = BARE_KEY.test(name) ? name : tomlString(name);
  return (
    `[mcp_servers.${key}]\n` +
    `command = ${tomlString(spec.command)}\n` +
    `args = [${spec.args.map(tomlString).join(", ")}]\n`
  );
}
