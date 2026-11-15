// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

export function usageText(): string {
  return [
    "Usage:",
    "  agent-cost-analyzer [--port <n>] [--no-open]",
    "  agent-cost-analyzer mcp [--project-billing-details] [--app-views-html <path>]",
    "  agent-cost-analyzer --help | --version",
    "",
    "Commands:",
    "  (none)                       Start the app and open the browser",
    "  mcp                          Run the MCP server on stdio",
    "",
    "Options:",
    "  --port <n>                   Use this port only (0 = any free port)",
    "  --no-open                    Do not open a browser",
    "  --project-billing-details    mcp: share client names and billing codes",
    "  --app-views-html <path>      mcp: serve this HTML file as the app views",
    "  -h, --help                   Show this help",
    "  -v, --version                Show the version",
    "",
  ].join("\n");
}
