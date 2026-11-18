// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

export function usageText(): string {
  return [
    "Usage:",
    "  agent-cost-analyzer [--port <n>] [--no-open]",
    "  agent-cost-analyzer mcp [--project-billing-details] [--app-views-html <path>]",
    "  agent-cost-analyzer mcp config --client <id> [--scope <s>] [--pin] [--project-billing-details]",
    "  agent-cost-analyzer mcp install [--client <id>[,<id>...]|all] [--scope <s>] [--pin] [--project-billing-details] [--dry-run] [--yes]",
    "  agent-cost-analyzer mcp uninstall [--client <id>[,<id>...]|all] [--scope <s>] [--dry-run] [--yes]",
    "  agent-cost-analyzer mcp status [--scope <s>]",
    "  agent-cost-analyzer --help | --version",
    "",
    "Commands:",
    "  (none)                       Start the app and open the browser",
    "  mcp                          Run the MCP server on stdio",
    "  mcp config                   Print how to register the server with one client",
    "  mcp install                  Register the server with your MCP clients",
    "  mcp uninstall                Remove the registration",
    "  mcp status                   Show where the server is registered",
    "",
    "Options:",
    "  --port <n>                   Use this port only (0 = any free port)",
    "  --no-open                    Do not open a browser",
    "  --project-billing-details    mcp: share client names and billing codes",
    "  --app-views-html <path>      mcp: serve this HTML file as the app views",
    "  --client <id>                mcp install|uninstall|config: claude-code, claude-desktop,",
    "                               cursor, vscode, vscode-insiders, codex, gemini; a comma list or all",
    "  --scope <s>                  mcp: user (default), project or local, where the client has it",
    "  --pin                        mcp install|config: register this exact version, not the latest",
    "  --dry-run                    mcp install|uninstall: show the plan and stop",
    "  --yes                        mcp install|uninstall: apply without asking",
    "  -h, --help                   Show this help",
    "  -v, --version                Show the version",
    "",
  ].join("\n");
}
