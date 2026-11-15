// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { readAppVersion } from "../composition/app-version.js";
import { loadBundledVendorProfiles } from "../composition/bundled-vendor-profiles.js";
import { composeLogProviders, type LogProviderCompositionOptions } from "../composition/compose-log-providers.js";
import { createStandalonePriceBook } from "../composition/create-price-book.js";
import { createStandaloneAttribution } from "../composition/create-standalone-attribution.js";
import { createTurnPricer } from "../composition/create-turn-pricer.js";
import { createMcpServices } from "../composition/mcp-services.js";
import { bundledDataDirsOf, type PackageLayout } from "../composition/package-layout.js";
import { FileStatementStore } from "../data-sources/statements/file-statement-store.js";
import { clockFromEnv } from "../platform/clock/clock-from-env.js";
import { priceBookHashOf } from "../services/billing/statement-service.js";
import { resolveAppViews } from "./apps/resolve-app-views.js";
import { createMcpServer, type McpServerDeps } from "./mcp-server.js";
import type { StdioArgs } from "./stdio-args.js";

const PREFIX = "agent-cost-analyzer MCP server:";

// The command-line options (stdio-args.ts) plus what an entry point decides.
export interface StandaloneMcpServerOptions extends LogProviderCompositionOptions, Partial<StdioArgs> {
  // A packaged build's files (npm-package.md §4.2), its views file
  // included; omitted, this package's own data and views only from
  // appViewsHtml (scripts/mcp-server.sh). An appViewsHtml wins over the
  // layout's views (§4.3).
  layout?: PackageLayout;
  // The clock port; AGENT_COST_ANALYZER_NOW's by default, as the standalone
  // app reads it (standalone-app.ts).
  now?: () => Date;
  // Diagnostics. stdout carries JSON-RPC only, so stderr by default.
  log?: (line: string) => void;
}

export interface StandaloneMcpServerFactory {
  // The version serverInfo reports, for the entry point's ready line.
  version: string;
  // docs/plans/mcp-sdk-2-migration.md D1: serveStdio calls the factory once
  // per connection and once per server/discover probe, so the services are
  // composed once, here, and each call only builds a server over them.
  createServer: () => McpServer;
}

const toStderr = (line: string): void => console.error(line);

// The standalone MCP server's composition root over every log provider:
// the same services as the HTTP app, reading its data, views and version
// from the layout when one is given. mcp/stdio.ts (dev) and the npm
// package's `mcp` subcommand (npm-package.md §4.6) serve it over stdio.
export function createStandaloneMcpServerFactory(options: StandaloneMcpServerOptions = {}): StandaloneMcpServerFactory {
  const { layout, projectBillingDetails = false, appViewsHtml = layout?.appViewsHtml, now = clockFromEnv(), log = toStderr, ...compositionOptions } = options;
  const version = readAppVersion(layout?.packageJsonPath);
  const data = bundledDataDirsOf(layout);

  const { registry, resolvedAppSettingsDir } = composeLogProviders(compositionOptions);
  // Phase 15 step 15.5: get_price_book reads the bundled book and the user's
  // versions in projects.json, as the web app does; step 15.6 prices turns
  // with the same book; step 15.7's cost analyses mark its price changes.
  const vendorProfiles = loadBundledVendorProfiles(data);
  const attribution = createStandaloneAttribution(registry, resolvedAppSettingsDir, vendorProfiles);
  const priceBook = createStandalonePriceBook(resolvedAppSettingsDir, attribution.catalog, data.priceBookDir);
  const deps: McpServerDeps = {
    // threat-model.md §5.6: list_projects shares client names and billing
    // codes with the chat model only when the user asks for it at launch.
    projectBillingDetails,
    // Phase 12 A13: the views resource and _meta.ui; no file, no views.
    ...resolveAppViews(appViewsHtml, (missing) => log(`${PREFIX} no app views at ${missing}; starting without them (run npm run build).`)),
    ...createMcpServices(registry, version, undefined, attribution, createTurnPricer(priceBook, now), priceBook, {
      // Step 15.11: get_statement reads the statements the app issued.
      store: new FileStatementStore(resolvedAppSettingsDir),
      projects: attribution.catalog,
      priceBookHash: () => priceBookHashOf(priceBook.list({}).versions),
    },
    // Phase 14 step 14.5: replay_session, compare_models_for_session and
    // estimate_cost's model, on the same profiles and price book.
    { profiles: vendorProfiles, priceBook },
    now),
    priceBook,
  };
  return { version, createServer: () => createMcpServer(deps) };
}

// docs/plans/mcp-sdk-2-migration.md D1: serveStdio answers 2025-era clients
// (initialize) and 2026-07-28 ones (server/discover, the per-request _meta
// envelope) from one process.
export function serveStandaloneMcpStdio(options: StandaloneMcpServerOptions = {}): void {
  const log = options.log ?? toStderr;
  const { version, createServer } = createStandaloneMcpServerFactory(options);
  serveStdio(createServer, { onerror: (error) => log(`${PREFIX} ${error.message}`) });
  log(`agent-cost-analyzer MCP server ${version} ready on stdio (read-only, local logs only).`);
}
