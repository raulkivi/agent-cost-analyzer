// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { McpSetupClientId } from "./types.js";

// The order is the contract's, and the tab order in the dialog.
export const CLIENT_IDS: readonly McpSetupClientId[] = [
  "claude-code",
  "claude-desktop",
  "cursor",
  "vscode",
  "vscode-insiders",
  "codex",
  "gemini",
];

export const CLIENT_LABELS: Record<McpSetupClientId, string> = {
  "claude-code": "Claude Code",
  "claude-desktop": "Claude Desktop",
  cursor: "Cursor",
  vscode: "VS Code",
  "vscode-insiders": "VS Code Insiders",
  codex: "Codex CLI",
  gemini: "Gemini CLI",
};

export const DEFAULT_CLIENT_ID: McpSetupClientId = "claude-code";

export function isClientId(value: unknown): value is McpSetupClientId {
  return typeof value === "string" && (CLIENT_IDS as readonly string[]).includes(value);
}

// Needs no API data, so the dialog can show it while loading and on an error.
export function installCommandFor(id: McpSetupClientId): string {
  return `npx agent-cost-analyzer mcp install --client ${id}`;
}

interface ClientNotes {
  // Under the by-hand block.
  manual?: string;
  // Under the Cursor install link.
  installLink?: string;
}

// UI strings, not API data: they describe the client, not this machine.
const NOTES: Partial<Record<McpSetupClientId, ClientNotes>> = {
  "claude-code": { manual: "Adds the server for every project (user scope). Run it in any terminal." },
  "claude-desktop": { manual: "Merge the entry into the existing file, then restart Claude Desktop." },
  cursor: { installLink: "The install link opens Cursor and asks you to confirm." },
  vscode: { manual: "Skip this if the AI Credits Analyzer extension is installed: it already provides the server." },
  "vscode-insiders": {
    manual: "Skip this if the AI Credits Analyzer extension is installed in Insiders: it already provides the server.",
  },
  codex: {
    manual:
      "Codex has no remove command. To remove the server, delete the [mcp_servers.agent-cost-analyzer] table from ~/.codex/config.toml.",
  },
  gemini: { manual: "Adds the server for every project (user scope)." },
};

export function notesFor(id: McpSetupClientId): ClientNotes {
  return NOTES[id] ?? {};
}
