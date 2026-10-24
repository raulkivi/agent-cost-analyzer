import type { ProductProfile } from "@copilot-cost-analyzer/domain";
import { loadLearnScenarios } from "../data-sources/learn-scenarios/loader.js";
import { checkConfig } from "../services/config-check/config-check.js";
import { ApiService } from "../services/api/api-service.js";
import { AuditQueryService } from "../services/tool-audit/audit-query-service.js";
import { readAppVersion } from "./app-version.js";
import { composeLogProviders, type LogProviderCompositionOptions } from "./compose-log-providers.js";
import { createInsightsService } from "./create-insights-service.js";

export interface StandaloneApiServiceOptions extends LogProviderCompositionOptions {
  // G4 (vscode-extension.md §2.2): both default to this package's own
  // files, located through import.meta.url.
  learnScenariosFixturesDir?: string;
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
    },
  };
}

// The standalone app's ApiService over every log provider and its
// file-backed app settings. The HTTP app (app.ts) is the only caller; the
// extension builds its own over a Copilot-only registry.
export function createStandaloneApiService(options: StandaloneApiServiceOptions = {}): ApiService {
  const { learnScenariosFixturesDir, appVersion: appVersionOption, ...compositionOptions } = options;
  const { registry, appSettings, resolvedVscodeSettingsPath } = composeLogProviders(compositionOptions);
  const appVersion = appVersionOption ?? readAppVersion();

  return new ApiService({
    registry,
    auditQueries: new AuditQueryService(registry),
    insights: createInsightsService(registry),
    settings: appSettings,
    checkConfig: (minRetainedSessionLogsThreshold) =>
      checkConfig({ settingsPath: resolvedVscodeSettingsPath, minRetainedSessionLogsThreshold }),
    learnScenarios: loadLearnScenarios({ fixturesDir: learnScenariosFixturesDir }),
    appVersion,
    productProfile: standaloneProductProfile(appVersion),
  });
}
