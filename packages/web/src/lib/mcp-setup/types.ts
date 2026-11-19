// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

// The GET /api/mcp/setup answer (mcp-client-setup.md §5.6). Defined here
// until MC11 puts the schema in packages/domain; then this file re-exports it.
export type McpSetupClientId =
  | "claude-code"
  | "claude-desktop"
  | "cursor"
  | "vscode"
  | "vscode-insiders"
  | "codex"
  | "gemini";

export interface McpSetupClient {
  id: McpSetupClientId;
  label: string;
  // "npx agent-cost-analyzer mcp install --client <id>"
  installCommand: string;
  manual: { kind: "command"; command: string } | { kind: "json"; path: string; json: string };
  // Cursor only.
  installLink?: string;
}

export interface McpSetupResponse {
  version: string;
  clients: McpSetupClient[];
}
