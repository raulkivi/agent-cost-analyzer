import type { ProductProfile } from "@agent-cost-analyzer/domain";
import { loadScenarioScripts } from "../data-sources/learn-scripts/loader.js";
import { loadVendorProfiles } from "../data-sources/vendor-profiles/loader.js";
import { LearnSimulationService } from "../services/learn-simulation/learn-simulation-service.js";
import { loadLearnScenarios } from "../data-sources/learn-scenarios/loader.js";
import { agentHostCatalogProbe } from "../services/config-check/agent-host-catalog-probe.js";
import { resolveUserDataDir } from "../platform/vscode-paths/resolve-user-data-dir.js";
import { checkConfig } from "../services/config-check/config-check.js";
import { ApiService } from "../services/api/api-service.js";
import { FileProjectStore } from "../data-sources/projects/file-project-store.js";
import { ProjectCatalog } from "../services/cost-attribution/project-catalog.js";
import { RepositoryListService } from "../services/cost-attribution/repository-list-service.js";
import { AuditQueryService } from "../services/tool-audit/audit-query-service.js";
import { readAppVersion } from "./app-version.js";
import { composeLogProviders, type LogProviderCompositionOptions } from "./compose-log-providers.js";
import { createInsightsService } from "./create-insights-service.js";
import { createSessionAttributor } from "./create-session-attributor.js";

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
      // The standalone HTTP routes arrive in step 13.10.
      vendorSimulation: false,
    },
  };
}

// The standalone app's ApiService over every log provider and its
// file-backed app settings. The HTTP app (app.ts) is the only caller; the
// extension builds its own over a Copilot-only registry.
export function createStandaloneApiService(options: StandaloneApiServiceOptions = {}): ApiService {
  const { learnScenariosFixturesDir, appVersion: appVersionOption, ...compositionOptions } = options;
  const { registry, appSettings, resolvedVscodeSettingsPath, resolvedAppSettingsDir } = composeLogProviders(compositionOptions);
  // Phase 15 step 15.3: projects.json beside settings.json.
  const projectCatalog = new ProjectCatalog(new FileProjectStore(resolvedAppSettingsDir));
  const vendorProfiles = loadVendorProfiles();
  // Step 15.4: the same attribution for the repository list and the dataset.
  const attributor = createSessionAttributor({ projects: projectCatalog, vendorProfiles });
  const appVersion = appVersionOption ?? readAppVersion();
  const agentHostUserDataDir =
    compositionOptions.agentHostUserDataDir !== undefined ? compositionOptions.agentHostUserDataDir : resolveUserDataDir();

  return new ApiService({
    registry,
    projects: {
      catalog: projectCatalog,
      repositories: new RepositoryListService(registry, attributor),
    },
    auditQueries: new AuditQueryService(registry),
    insights: createInsightsService(registry, attributor),
    settings: appSettings,
    checkConfig: (minRetainedSessionLogsThreshold) =>
      checkConfig({
        settingsPath: resolvedVscodeSettingsPath,
        minRetainedSessionLogsThreshold,
        agentHostCatalogPresent: agentHostCatalogProbe(agentHostUserDataDir),
      }),
    learnScenarios: loadLearnScenarios({ fixturesDir: learnScenariosFixturesDir }),
    learnSimulation: new LearnSimulationService(loadScenarioScripts(), vendorProfiles, "claude-code"),
    appVersion,
    productProfile: standaloneProductProfile(appVersion),
  });
}
