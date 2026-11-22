// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ProductProfile } from "@agent-cost-analyzer/domain";
import { DatasetCostCubeSource } from "../services/cost-analysis/cost-analysis-service.js";
import { FileStatementStore } from "../data-sources/statements/file-statement-store.js";
import { priceBookHashOf, StatementService } from "../services/billing/statement-service.js";
import { EstimateService } from "../services/billing/estimate-service.js";
import { loadScenarioScripts } from "../data-sources/learn-scripts/loader.js";
import { LearnSimulationService } from "../services/learn-simulation/learn-simulation-service.js";
import { createSimulatedScenarioCatalog } from "../services/learn-simulation/simulated-scenario-catalog.js";
import { agentHostCatalogProbe } from "../services/config-check/agent-host-catalog-probe.js";
import { resolveUserDataDir } from "../platform/vscode-paths/resolve-user-data-dir.js";
import { checkConfig } from "../services/config-check/config-check.js";
import { ApiService } from "../services/api/api-service.js";
import { AuditQueryService } from "../services/tool-audit/audit-query-service.js";
import { createMonthlyAllowance } from "./create-monthly-allowance.js";
import { readAppVersion } from "./app-version.js";
import { createStandalonePriceBook } from "./create-price-book.js";
import { loadBundledVendorProfiles } from "./bundled-vendor-profiles.js";
import type { BundledDataDirs } from "./package-layout.js";
import { composeLogProviders, type LogProviderCompositionOptions } from "./compose-log-providers.js";
import { createInsightsService } from "./create-insights-service.js";
import { createStandaloneAttribution } from "./create-standalone-attribution.js";
import { createTurnPricer } from "./create-turn-pricer.js";
import { createCostAnalysis, projectDirectoryOf } from "./create-cost-analysis.js";
import { createSavingsReport } from "./create-savings-report.js";
import { createSessionReplay } from "./create-session-replay.js";

// G4 (vscode-extension.md §2.2): the data folders default to this package's
// own files, located through import.meta.url; a packaged build passes its
// layout's (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/npm-package.md §4.2).
export interface StandaloneApiServiceOptions extends LogProviderCompositionOptions, BundledDataDirs {
  appVersion?: string;
  // The clock (plan §12.4.1): the real one unless a test or the
  // usage-scenario suite fixes it (standalone-app.ts reads AGENT_COST_ANALYZER_NOW).
  now?: () => Date;
  // Step 15.11 (D6): the time zone statements bill in; the machine's by default.
  timeZone?: string;
}

// The standalone app's product profile (vscode-extension.md §3.3): every
// provider is registered, so the UI offers the provider select and
// cross-provider insights; it has no editor to open settings or documents in.
export function standaloneProductProfile(version: string): ProductProfile {
  return {
    productId: "standalone",
    displayName: "Agent Cost Analyzer",
    version,
    features: {
      providerSelect: true,
      crossProviderInsights: true,
      settingFixes: false,
      openInEditor: false,
      sessionSidebar: false,
      vendorSimulation: true,
      // Step 15.9: GET /api/cost/* behind the Dashboard's cost tabs.
      costAnalysis: true,
      // Steps 15.10-15.12: projects, statements and estimates.
      projectsAndBilling: true,
      // Phase 14 step 14.7: its ApiService always has a session replay.
      sessionReplay: true,
      savingsReport: true,
      // MS4: the allowance in settings.json and its gauge.
      monthlyAllowance: true,
    },
  };
}

// The standalone app's ApiService over every log provider and its
// file-backed app settings. The HTTP app (app.ts) is the only caller; the
// extension builds its own over a Copilot-only registry.
export function createStandaloneApiService(options: StandaloneApiServiceOptions = {}): ApiService {
  const { learnScriptsDir, vendorProfilesDir, priceBookDir, appVersion: appVersionOption, now, timeZone, ...compositionOptions } = options;
  const { registry, appSettings, resolvedVscodeSettingsPath, resolvedAppSettingsDir } = composeLogProviders(compositionOptions);
  const vendorProfiles = loadBundledVendorProfiles({ vendorProfilesDir, priceBookDir });
  // Phase 15: projects.json beside settings.json (step 15.3); the same
  // attribution for the repository list and the dataset (step 15.4).
  const attribution = createStandaloneAttribution(registry, resolvedAppSettingsDir, vendorProfiles);
  // Step 15.5/15.6: one price book for GET /api/price-book and the priced cost basis.
  const priceBook = createStandalonePriceBook(resolvedAppSettingsDir, attribution.catalog, priceBookDir);
  const appVersion = appVersionOption ?? readAppVersion();
  const agentHostUserDataDir =
    compositionOptions.agentHostUserDataDir !== undefined ? compositionOptions.agentHostUserDataDir : resolveUserDataDir();

  const pricer = createTurnPricer(priceBook, now);
  const insights = createInsightsService(registry, attribution.dataset, pricer, now);
  const sessionReplay = createSessionReplay({ providers: registry, profiles: vendorProfiles, priceBook, pricer, attribution: attribution.dataset });

  const learnSimulation = new LearnSimulationService(
    loadScenarioScripts(learnScriptsDir),
    vendorProfiles,
    "claude-code",
  );

  return new ApiService({
    registry,
    projects: {
      catalog: attribution.catalog,
      repositories: attribution.repositories,
    },
    priceBook,
    sessionPricing: { attribution: attribution.dataset, pricer },
    // Step 15.7: cost over time and compare, over the same dataset.
    costAnalysis: createCostAnalysis(insights, priceBook, projectDirectoryOf(attribution.catalog), now),
    // Step 15.12: estimates over the same dataset, at today's prices.
    estimates: new EstimateService({ cubes: new DatasetCostCubeSource(insights), projects: projectDirectoryOf(attribution.catalog), ...(now ? { now } : {}) }),
    // Step 15.11: statements over the same dataset, kept beside projects.json.
    statements: new StatementService({
      cubes: new DatasetCostCubeSource(insights),
      store: new FileStatementStore(resolvedAppSettingsDir),
      projects: attribution.catalog,
      priceBookHash: () => priceBookHashOf(priceBook.list({}).versions),
      appVersion,
      timeZone: timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...(now ? { now } : {}),
    }),
    // Phase 14 step 14.5: replays priced from the same price book, with the
    // session's measured figures from the same attribution and pricer.
    sessionReplay,
    // Phase 16 SR12 (D10 is the extension's): every provider, the replay above
    // for the cheaper-model saving, and the same pricer and attribution.
    savingsReport: createSavingsReport({ providers: registry, profiles: vendorProfiles, priceBook, pricer, attribution: attribution.dataset, replay: sessionReplay, ...(now ? { now } : {}) }),
    // MS4: the VS Code provider's sessions whatever provider is active (D5).
    monthlyAllowance: createMonthlyAllowance(registry, resolvedAppSettingsDir, { agentHostUserDataDir, now, timeZone }),
    auditQueries: new AuditQueryService(registry),
    insights,
    settings: appSettings,
    checkConfig: (minRetainedSessionLogsThreshold) =>
      checkConfig({
        settingsPath: resolvedVscodeSettingsPath,
        minRetainedSessionLogsThreshold,
        agentHostCatalogPresent: agentHostCatalogProbe(agentHostUserDataDir),
      }),
    learnScenarios: createSimulatedScenarioCatalog(learnSimulation),
    learnSimulation,
    appVersion,
    productProfile: standaloneProductProfile(appVersion),
  });
}
