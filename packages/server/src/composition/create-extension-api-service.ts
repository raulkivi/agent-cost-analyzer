// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
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
      // Step 15.9: the extension has no cost routes until step 15.14.
      costAnalysis: false,
    },
  };
}

// The extension's ApiService over the Copilot-only registry and the
// extension's own settings store. Unlike create-standalone-api-service.ts
// it never imports the Express app or any non-Copilot provider; the
// extension's bundle-boundary test enforces that.
function pricerBeside(vendorProfilesDir: string) {
  const book = createBundledPriceBookBeside(vendorProfilesDir);
  return book ? createTurnPricer(book) : undefined;
}

export function createExtensionApiService(options: ExtensionApiServiceOptions): ApiService {
  const { learnScriptsDir, vendorProfilesDir, appVersion, settingsSource, ...compositionOptions } = options;
  const { registry, appSettings, resolvedVscodeSettingsPath } = composeCopilotProviders(compositionOptions);

  const vendorProfiles = loadVendorProfiles(vendorProfilesDir);
  // Copilot users see VS Code wording (D13/D14).
  const learnSimulation = new LearnSimulationService(loadScenarioScripts(learnScriptsDir), vendorProfiles, "vscode-local");

  return new ApiService({
    registry,
    auditQueries: new AuditQueryService(registry),
    // Step 15.4: repository, vendor and channel; no projects file until step 15.14.
    // Step 15.6: Copilot turns priced from the bundled price book, so billed
    // and priced figures can be compared.
    insights: createInsightsService(registry, createSessionAttributor({ vendorProfiles }), pricerBeside(vendorProfilesDir)),
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
