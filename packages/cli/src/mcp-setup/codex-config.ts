// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { MCP_SERVER_NAME } from "../../../server/src/mcp/client-setup/launch-spec.js";

const NAME = MCP_SERVER_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TABLE_HEADER = new RegExp(
  `^\\s*\\[\\s*mcp_servers\\s*\\.\\s*(?:"${NAME}"|${NAME})\\s*\\]\\s*(?:#.*)?$`,
);
const ANY_HEADER = /^\s*\[/;

export interface CodexServerTable {
  command?: string;
  args?: string[];
}

/**
 * Finds our `[mcp_servers.<name>]` table. Not a TOML parser: it reads the
 * header and the one-line `command = "…"` and `args = ["…", …]` that
 * `codex mcp add` writes, and leaves a field out when it is written any
 * other way. Returns undefined when the table is absent.
 */
export function findCodexServerTable(
  text: string,
): CodexServerTable | undefined {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => TABLE_HEADER.test(l));
  if (start < 0) return undefined;
  const table: CodexServerTable = {};
  for (const line of lines.slice(start + 1)) {
    if (ANY_HEADER.test(line)) break;
    const command = /^\s*command\s*=\s*("(?:[^"\\]|\\.)*")\s*(?:#.*)?$/.exec(
      line,
    );
    if (command) table.command = parseJson(command[1]) as string | undefined;
    const args = /^\s*args\s*=\s*(\[.*\])\s*(?:#.*)?$/.exec(line);
    if (args) {
      const parsed = parseJson(args[1]);
      if (Array.isArray(parsed) && parsed.every((a) => typeof a === "string"))
        table.args = parsed as string[];
    }
  }
  return table;
}

// TOML basic strings use JSON's escapes for everything `codex` writes.
function parseJson(text: string | undefined): unknown {
  try {
    return text === undefined ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
}
