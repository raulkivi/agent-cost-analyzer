import type { ProductProfile } from "@copilot-cost-analyzer/domain";
import { loadLearnScenarios } from "../data-sources/learn-scenarios/loader.js";
import { checkConfig } from "../services/config-check/config-check.js";
import { ApiService } from "../services/api/api-service.js";
import { AuditQueryService } from "../services/tool-audit/audit-query-service.js";
import { composeCopilotProviders, type CopilotProviderCompositionOptions } from "./compose-copilot-providers.js";
import { createInsightsService } from "./create-insights-service.js";

export interface ExtensionApiServiceOptions extends CopilotProviderCompositionOptions {
  // G4 (vscode-extension.md §2.2): required, because the extension runs as
  // a single CJS bundle with no usable import.meta.url to default from.
  learnScenariosFixturesDir: string;
  appVersion: string;
}

// The extension's product profile (vscode-extension.md §3.3): only the
// Copilot provider is registered, so there's no provider select and no
// cross-provider wording. settingFixes and openInEditor stay false until
// step 10.5 implements the HostCapabilities behind them.
export function extensionProductProfile(version: string): ProductProfile {
  return {
    productId: "vscode-extension",
    displayName: "AI Credits Analyzer",
    version,
    features: {
      providerSelect: false,
      crossProviderInsights: false,
      settingFixes: false,
      openInEditor: false,
    },
  };
}

// The extension's ApiService over the Copilot-only registry and the
// extension's own settings store. Unlike create-standalone-api-service.ts
// it never imports the Express app or any non-Copilot provider; the
// extension's bundle-boundary test enforces that.
export function createExtensionApiService(options: ExtensionApiServiceOptions): ApiService {
  const { learnScenariosFixturesDir, appVersion, ...compositionOptions } = options;
  const { registry, appSettings, resolvedVscodeSettingsPath } = composeCopilotProviders(compositionOptions);

  return new ApiService({
    registry,
    auditQueries: new AuditQueryService(registry),
    insights: createInsightsService(registry),
    settings: appSettings,
    checkConfig: (minRetainedSessionLogsThreshold) =>
      checkConfig({ settingsPath: resolvedVscodeSettingsPath, minRetainedSessionLogsThreshold }),
    learnScenarios: loadLearnScenarios({ fixturesDir: learnScenariosFixturesDir }),
    appVersion,
    productProfile: extensionProductProfile(appVersion),
  });
}
