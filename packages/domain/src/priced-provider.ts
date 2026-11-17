// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

// Step CS13: providers whose sessions have no AI Credits and show a priced
// cost instead (Claude Code). One rule for the web app, the API and the MCP
// session cost, so the chat views and the app never disagree on it.
const PRICED_PROVIDER_IDS: ReadonlySet<string> = new Set(["claude-code"]);

export function isPricedProvider(providerId: string | undefined): boolean {
  return providerId !== undefined && PRICED_PROVIDER_IDS.has(providerId);
}
