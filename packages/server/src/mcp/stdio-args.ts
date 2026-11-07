// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

// Command-line options of the standalone stdio entry point (stdio.ts). Pure,
// so the parsing is testable without spawning the server.
export interface StdioArgs {
  // threat-model.md §5.6: list_projects shares client names and billing codes.
  projectBillingDetails: boolean;
  // Serve this built HTML file (packages/mcp-apps/dist/views.html) as the MCP
  // App views resource. Absent or missing file = no app views.
  appViewsHtml?: string;
}

const APP_VIEWS_FLAG = "--app-views-html";

export function parseStdioArgs(argv: readonly string[]): StdioArgs {
  const args: StdioArgs = { projectBillingDetails: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--project-billing-details") {
      args.projectBillingDetails = true;
    } else if (arg === APP_VIEWS_FLAG || arg.startsWith(`${APP_VIEWS_FLAG}=`)) {
      const value = arg === APP_VIEWS_FLAG ? argv[++i] : arg.slice(APP_VIEWS_FLAG.length + 1);
      if (!value || value.startsWith("--")) throw new Error(`${APP_VIEWS_FLAG} needs a path to an HTML file`);
      args.appViewsHtml = value;
    }
  }
  return args;
}
