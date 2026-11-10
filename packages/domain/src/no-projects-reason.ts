// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

// Why the extension has no projects. One source for the server (which sends it
// with an unknown project id and as the projects listing's reason) and the MCP
// App views (which show it); neither copies the wording. Fixed text: it names
// the product, never logged text.
export const EXTENSION_NO_PROJECTS_REASON =
  "AI Credits Analyzer has no projects: projects are edited in the standalone Agent Cost Analyzer app. Every turn is in No project; repositories are listed as usual.";
