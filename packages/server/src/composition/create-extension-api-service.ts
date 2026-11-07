import type { ProductProfile } from "@agent-cost-analyzer/domain";
import { loadScenarioScripts } from "../data-sources/learn-scripts/loader.js";
import { loadVendorProfiles } from "../data-sources/vendor-profiles/loader.js";
import { LearnSimulationService } from "../services/learn-simulation/learn-simulation-service.js";
import { createSimulatedScenarioCatalog } from "../services/learn-simulation/simulated-scenario-catalog.js";
import { agentHostCatalogProbe } from "../services/config-check/agent-host-catalog-probe.js";
import { checkConfig } from "../services/config-check/config-check.js";
import type { SettingsSource } from "../services/config-check/settings-source.js";
import { ApiService } from "../services/api/api-service.js";
import { AuditQueryService } from "../services/tool-audit/audit-query-service.js";
import { composeCopilotProviders, type CopilotProviderCompositionOptions } from "./compose-copilot-providers.js";
import { createInsightsService } from "./create-insights-service.js";
import { createSessionAttributor } from "./create-session-attributor.js";
import { createBundledPriceBookBeside } from "./create-price-book.js";
import { createTurnPricer } from "./create-turn-pricer.js";
import { createCostAnalysis } from "./create-cost-analysis.js";
import { createSessionReplay } from "./create-session-replay.js";

export interface ExtensionApiServiceOptions extends CopilotProviderCompositionOptions {
  // The effective VS Code settings the config check judges (G6: the
  // extension passes one over vscode.workspace.getConfiguration()). Omitted,
  // the check reads the settings.json at vscodeSettingsPath.
  settingsSource?: SettingsSource;
  // G4 (vscode-extension.md §2.2): required, because the extension runs as
  // a single CJS bundle with no usable import.meta.url to default from, so it
  // can't locate the simulator's data itself.
  learnScriptsDir: string;
  vendorProfilesDir: string;
  appVersion: string;
}

// The extension's product profile (vscode-extension.md §3.3): only the
// Copilot provider is registered, so there's no provider select and no
// cross-provider wording. The extension host implements the openSetting and
// openTextDocument host commands (step 10.5), so setting fixes and
// open-in-editor are on.
export function extensionProductProfile(version: string): ProductProfile {
  return {
    productId: "vscode-extension",
    displayName: "AI Credits Analyzer",
    version,
    features: {
      providerSelect: false,
      crossProviderInsights: false,
      settingFixes: true,
      openInEditor: true,
      sessionSidebar: true,
      vendorSimulation: true,
      // Step 15.14: Cost over time and Compare over the Copilot sessions;
      // no projects file and no billing here (D7, D19).
      costAnalysis: true,
      projectsAndBilling: false,
    },
  };
}

// The extension's ApiService over the Copilot-only registry and the
// extension's own settings store. Unlike create-standalone-api-service.ts
// it never imports the Express app or any non-Copilot provider; the
// extension's bundle-boundary test enforces that.
export function createExtensionApiService(options: ExtensionApiServiceOptions): ApiService {
  const { learnScriptsDir, vendorProfilesDir, appVersion, settingsSource, ...compositionOptions } = options;
  const { registry, appSettings, resolvedVscodeSettingsPath } = composeCopilotProviders(compositionOptions);

  const vendorProfiles = loadVendorProfiles(vendorProfilesDir);
  // Copilot users see VS Code wording (D13/D14).
  const learnSimulation = new LearnSimulationService(loadScenarioScripts(learnScriptsDir), vendorProfiles, "vscode-local");

  // Step 15.4: repository, vendor and channel; no projects file (D19), so
  // every turn is in No project. Step 15.6: Copilot turns priced from the
  // bundled price book, so billed and priced figures can be compared.
  const priceBook = createBundledPriceBookBeside(vendorProfilesDir);
  const attribution = createSessionAttributor({ vendorProfiles });
  const pricer = priceBook ? createTurnPricer(priceBook) : undefined;
  const insights = createInsightsService(registry, attribution, pricer);

  return new ApiService({
    registry,
    auditQueries: new AuditQueryService(registry),
    insights,
    // Step 15.14: the Dashboard's Cost over time and Compare tabs, over the
    // same dataset, with the bundled price book's documented changes.
    costAnalysis: createCostAnalysis(insights, priceBook),
    // Phase 14 step 14.5 (D5): Copilot sessions replayed on another model,
    // priced from the bundled price book with the same attribution and
    // pricer as the Dashboard. Without a price book a replay can't be
    // priced, so the method answers "not available".
    ...(priceBook && pricer
      ? { sessionReplay: createSessionReplay({ providers: registry, profiles: vendorProfiles, priceBook, pricer, attribution }) }
      : {}),
    settings: appSettings,
    checkConfig: (minRetainedSessionLogsThreshold) =>
      checkConfig({
        settings: settingsSource,
        settingsPath: resolvedVscodeSettingsPath,
        minRetainedSessionLogsThreshold,
        agentHostCatalogPresent: agentHostCatalogProbe(compositionOptions.agentHostUserDataDir),
      }),
    learnScenarios: createSimulatedScenarioCatalog(learnSimulation),
    learnSimulation,
    appVersion,
    productProfile: extensionProductProfile(appVersion),
  });
}
