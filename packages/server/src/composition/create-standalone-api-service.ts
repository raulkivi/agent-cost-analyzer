import type { ProductProfile } from "@agent-cost-analyzer/domain";
import { loadScenarioScripts } from "../data-sources/learn-scripts/loader.js";
import { loadVendorProfiles } from "../data-sources/vendor-profiles/loader.js";
import { LearnSimulationService } from "../services/learn-simulation/learn-simulation-service.js";
import { createSimulatedScenarioCatalog } from "../services/learn-simulation/simulated-scenario-catalog.js";
import { agentHostCatalogProbe } from "../services/config-check/agent-host-catalog-probe.js";
import { resolveUserDataDir } from "../platform/vscode-paths/resolve-user-data-dir.js";
import { checkConfig } from "../services/config-check/config-check.js";
import { ApiService } from "../services/api/api-service.js";
import { AuditQueryService } from "../services/tool-audit/audit-query-service.js";
import { readAppVersion } from "./app-version.js";
import { createStandalonePriceBook } from "./create-price-book.js";
import { composeLogProviders, type LogProviderCompositionOptions } from "./compose-log-providers.js";
import { createInsightsService } from "./create-insights-service.js";
import { createStandaloneAttribution } from "./create-standalone-attribution.js";
import { createTurnPricer } from "./create-turn-pricer.js";
import { createCostAnalysis, projectDirectoryOf } from "./create-cost-analysis.js";

export interface StandaloneApiServiceOptions extends LogProviderCompositionOptions {
  // G4 (vscode-extension.md §2.2): default to this package's own files,
  // located through import.meta.url.
  learnScriptsDir?: string;
  vendorProfilesDir?: string;
  appVersion?: string;
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
    },
  };
}

// The standalone app's ApiService over every log provider and its
// file-backed app settings. The HTTP app (app.ts) is the only caller; the
// extension builds its own over a Copilot-only registry.
export function createStandaloneApiService(options: StandaloneApiServiceOptions = {}): ApiService {
  const { learnScriptsDir, vendorProfilesDir, appVersion: appVersionOption, ...compositionOptions } = options;
  const { registry, appSettings, resolvedVscodeSettingsPath, resolvedAppSettingsDir } = composeLogProviders(compositionOptions);
  const vendorProfiles = loadVendorProfiles(vendorProfilesDir);
  // Phase 15: projects.json beside settings.json (step 15.3); the same
  // attribution for the repository list and the dataset (step 15.4).
  const attribution = createStandaloneAttribution(registry, resolvedAppSettingsDir, vendorProfiles);
  // Step 15.5/15.6: one price book for GET /api/price-book and the priced cost basis.
  const priceBook = createStandalonePriceBook(resolvedAppSettingsDir, attribution.catalog);
  const appVersion = appVersionOption ?? readAppVersion();
  const agentHostUserDataDir =
    compositionOptions.agentHostUserDataDir !== undefined ? compositionOptions.agentHostUserDataDir : resolveUserDataDir();

  const insights = createInsightsService(registry, attribution.dataset, createTurnPricer(priceBook));

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
    // Step 15.7: cost over time and compare, over the same dataset.
    costAnalysis: createCostAnalysis(insights, priceBook, projectDirectoryOf(attribution.catalog)),
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
