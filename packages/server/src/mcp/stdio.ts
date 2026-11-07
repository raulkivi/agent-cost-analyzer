// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { composeLogProviders } from "../composition/compose-log-providers.js";
import { createStandalonePriceBook } from "../composition/create-price-book.js";
import { createStandaloneAttribution } from "../composition/create-standalone-attribution.js";
import { createMcpServices } from "../composition/mcp-services.js";
import { createTurnPricer } from "../composition/create-turn-pricer.js";
import { readAppVersion } from "../composition/app-version.js";
import { createMcpServer } from "./mcp-server.js";

// stdio entry point for `claude mcp add` (see docs/plans/tool-call-audit.md
// §10 and scripts/mcp-server.sh). stdout carries JSON-RPC only — anything
// diagnostic must go to stderr. The extension's Copilot-only entry point
// (packages/vscode-extension/src/mcp/stdio.ts) wires the same services
// over its own composition root.
const version = readAppVersion();

const { registry, resolvedAppSettingsDir } = composeLogProviders();
// Phase 15 step 15.5: get_price_book reads the bundled book and the user's
// versions in projects.json, as the web app does; step 15.6 prices turns
// with the same book; step 15.7's cost analyses mark its price changes.
const attribution = createStandaloneAttribution(registry, resolvedAppSettingsDir);
const priceBook = createStandalonePriceBook(resolvedAppSettingsDir, attribution.catalog);
const server = createMcpServer({
  ...createMcpServices(registry, version, undefined, attribution, createTurnPricer(priceBook), priceBook),
  priceBook,
});

await server.connect(new StdioServerTransport());
console.error(`agent-cost-analyzer MCP server ${version} ready on stdio (read-only, local logs only).`);
