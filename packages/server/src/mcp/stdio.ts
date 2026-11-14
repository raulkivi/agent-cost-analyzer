// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { composeLogProviders } from "../composition/compose-log-providers.js";
import { createStandalonePriceBook } from "../composition/create-price-book.js";
import { createStandaloneAttribution } from "../composition/create-standalone-attribution.js";
import { createMcpServices } from "../composition/mcp-services.js";
import { createTurnPricer } from "../composition/create-turn-pricer.js";
import { loadVendorProfiles } from "../data-sources/vendor-profiles/loader.js";
import { readAppVersion } from "../composition/app-version.js";
import { createMcpServer, type McpServerDeps } from "./mcp-server.js";
import { resolveAppViews } from "./apps/resolve-app-views.js";
import { clockFromEnv } from "../platform/clock/clock-from-env.js";
import { parseStdioArgs } from "./stdio-args.js";
import { FileStatementStore } from "../data-sources/statements/file-statement-store.js";
import { priceBookHashOf } from "../services/billing/statement-service.js";

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
const vendorProfiles = loadVendorProfiles();
const attribution = createStandaloneAttribution(registry, resolvedAppSettingsDir, vendorProfiles);
const priceBook = createStandalonePriceBook(resolvedAppSettingsDir, attribution.catalog);
// threat-model.md §5.6: list_projects shares client names and billing codes
// with the chat model only when the user asks for it at launch.
const { projectBillingDetails, appViewsHtml } = parseStdioArgs(process.argv.slice(2));
const now = clockFromEnv();
const deps: McpServerDeps = {
  projectBillingDetails,
  // --app-views-html (scripts/mcp-server.sh passes the built views.html): the views resource and _meta.ui; no file, no views.
  ...resolveAppViews(appViewsHtml, (missing) => console.error(`agent-cost-analyzer MCP server: no app views at ${missing}; starting without them (run npm run build).`)),
  ...createMcpServices(registry, version, undefined, attribution, createTurnPricer(priceBook, now), priceBook, {
    // Step 15.11: get_statement reads the statements the app issued.
    store: new FileStatementStore(resolvedAppSettingsDir),
    projects: attribution.catalog,
    priceBookHash: () => priceBookHashOf(priceBook.list({}).versions),
  },
  // Phase 14 step 14.5: replay_session, compare_models_for_session and
  // estimate_cost's model, on the same profiles and price book.
  { profiles: vendorProfiles, priceBook },
  // AGENT_COST_ANALYZER_NOW, as the standalone app reads it (server.ts).
  now),
  priceBook,
};

// docs/plans/mcp-sdk-2-migration.md D1: serveStdio answers 2025-era clients
// (initialize) and 2026-07-28 ones (server/discover, the per-request _meta
// envelope). It calls the factory once per connection and once per discover
// probe, so the services above are composed once and the factory only
// builds a server over them.
serveStdio(() => createMcpServer(deps), {
  onerror: (error) => console.error(`agent-cost-analyzer MCP server: ${error.message}`),
});
console.error(`agent-cost-analyzer MCP server ${version} ready on stdio (read-only, local logs only).`);
