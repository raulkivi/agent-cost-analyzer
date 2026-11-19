// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { CLIENT_IDS, CLIENT_LABELS, installCommandFor } from "../lib/mcp-setup/clients.js";
import type { McpSetupClient, McpSetupResponse } from "../lib/mcp-setup/types.js";

const JSON_SNIPPET = `{
  "mcpServers": {
    "agent-cost-analyzer": {
      "command": "npx",
      "args": ["-y", "--prefer-offline", "agent-cost-analyzer", "mcp"]
    }
  }
}`;

function clientFor(id: McpSetupClient["id"]): McpSetupClient {
  const base = { id, label: CLIENT_LABELS[id], installCommand: installCommandFor(id) };
  switch (id) {
    case "claude-desktop":
      return { ...base, manual: { kind: "json", path: "~/.config/Claude/claude_desktop_config.json", json: JSON_SNIPPET } };
    case "cursor":
      return {
        ...base,
        manual: { kind: "json", path: "~/.cursor/mcp.json", json: JSON_SNIPPET },
        installLink: "cursor://anysphere.cursor-deeplink/mcp/install?name=agent-cost-analyzer&config=e30%3D",
      };
    case "vscode":
    case "vscode-insiders":
      return { ...base, manual: { kind: "json", path: `~/.config/${id === "vscode" ? "Code" : "Code - Insiders"}/User/mcp.json`, json: JSON_SNIPPET.replace("mcpServers", "servers") } };
    case "codex":
      return { ...base, manual: { kind: "command", command: "codex mcp add agent-cost-analyzer -- npx -y --prefer-offline agent-cost-analyzer mcp" } };
    case "gemini":
      return { ...base, manual: { kind: "command", command: "gemini mcp add -s user agent-cost-analyzer npx -y --prefer-offline agent-cost-analyzer mcp" } };
    case "claude-code":
      return { ...base, manual: { kind: "command", command: "claude mcp add --scope user agent-cost-analyzer -- npx -y --prefer-offline agent-cost-analyzer mcp" } };
  }
}

export function mcpSetupResponse(): McpSetupResponse {
  return { version: "1.1.0", clients: CLIENT_IDS.map(clientFor) };
}
