import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { productProfileSchema } from "@copilot-cost-analyzer/domain";
import { InMemoryAppSettingsStore } from "../test-support/in-memory-app-settings-store.js";
import { createExtensionApiService } from "./create-extension-api-service.js";

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/learn-scenarios");

function buildService(appSettings = new InMemoryAppSettingsStore()) {
  return createExtensionApiService({
    sessionStoreDbPath: path.join("/nonexistent", "state.vscdb"),
    debugLogsDirPaths: [],
    agentTracesDbPath: null,
    vscodeSettingsPath: null,
    appSettings,
    learnScenariosFixturesDir: fixturesDir,
    appVersion: "0.1.0-test",
  });
}

describe("createExtensionApiService (extension composition, vscode-extension.md §3.1/§3.3)", () => {
  it("reports the extension's ProductProfile and the injected version", async () => {
    const service = buildService();

    expect(productProfileSchema.parse(await service.getProductProfile())).toEqual({
      productId: "vscode-extension",
      displayName: "AI Credits Analyzer",
      version: "0.1.0-test",
      features: {
        providerSelect: false,
        crossProviderInsights: false,
        settingFixes: false,
        openInEditor: false,
      },
    });
    expect(await service.getHealth()).toEqual({ status: "ok", version: "0.1.0-test" });
  });

  it("lists only the VS Code provider", async () => {
    const status = await buildService().getLogProviderStatus();

    expect(status.activeProviderId).toBe("vscode");
    expect(status.providers.map((provider) => provider.id)).toEqual(["vscode"]);
  });

  it("serves Learn mode from the injected fixtures dir (G4)", async () => {
    const scenarios = await buildService().listLearnScenarios();

    expect(scenarios.length).toBeGreaterThan(0);
    expect(scenarios.every((scenario) => scenario.mode === "learn")).toBe(true);
  });

  it("keeps the retention threshold in the injected store (D5)", async () => {
    const appSettings = new InMemoryAppSettingsStore();

    await buildService(appSettings).setRetentionThreshold(300);

    expect(appSettings.readMinRetainedSessionLogsThreshold()).toBe(300);
  });
});
