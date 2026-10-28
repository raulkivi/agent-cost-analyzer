import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { productProfileSchema } from "@agent-cost-analyzer/domain";
import { InMemoryAppSettingsStore } from "../test-support/in-memory-app-settings-store.js";
import type { SettingsSource } from "../services/config-check/settings-source.js";
import { createExtensionApiService } from "./create-extension-api-service.js";

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/learn-scenarios");

function buildService(appSettings = new InMemoryAppSettingsStore(), settingsSource?: SettingsSource, agentHostUserDataDir: string | null = null) {
  return createExtensionApiService({
    sessionStoreDbPath: path.join("/nonexistent", "state.vscdb"),
    debugLogsDirPaths: [],
    agentTracesDbPath: null,
    agentHostUserDataDir,
    vscodeSettingsPath: null,
    appSettings,
    settingsSource,
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
        settingFixes: true,
        openInEditor: true,
        sessionSidebar: true,
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

  it("reads the config status through the injected SettingsSource (G6)", async () => {
    const values: Record<string, unknown> = {
      "github.copilot.chat.agentDebugLog.fileLogging.enabled": true,
      "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs": 250,
      "github.copilot.chat.otel.dbSpanExporter.enabled": true,
    };
    const source: SettingsSource = {
      get: (id) => values[id],
      describe: () => ({ located: true, userSettingsPath: "/u/settings.json" }),
    };
    const service = buildService(new InMemoryAppSettingsStore(), source);

    expect(await service.getConfigStatus()).toMatchObject({ vscodeUserSettingsPath: "/u/settings.json", maxRetainedSessionLogs: 250, warnings: [] });

    values["github.copilot.chat.agentDebugLog.fileLogging.enabled"] = false;

    expect((await service.getConfigStatus()).warnings.map((warning) => warning.code)).toEqual(["logging-disabled"]);
  });

  it("downgrades the classic logging warning once the Agent Host catalog exists", async () => {
    const userDataDir = mkdtempSync(path.join(tmpdir(), "ext-ah-"));
    try {
      const source: SettingsSource = {
        get: () => undefined,
        describe: () => ({ located: true, userSettingsPath: "/u/settings.json" }),
      };
      const service = buildService(new InMemoryAppSettingsStore(), source, userDataDir);
      const severity = async () =>
        (await service.getConfigStatus()).warnings.find((w) => w.code === "logging-disabled")?.severity;

      expect(await severity()).toBe("required");
      mkdirSync(path.join(userDataDir, "User", "globalStorage"), { recursive: true });
      writeFileSync(path.join(userDataDir, "User", "globalStorage", "agent-host.db"), "");
      expect(await severity()).toBe("optional");
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  it("falls back to the settings.json file reader without a SettingsSource", async () => {
    const status = await buildService().getConfigStatus();

    expect(status.warnings.map((warning) => warning.code)).toEqual(["settings-not-found"]);
  });
});
