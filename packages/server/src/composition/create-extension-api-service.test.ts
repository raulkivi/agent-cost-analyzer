// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { productProfileSchema, sessionReplayComparisonSchema, sessionReplaySchema } from "@agent-cost-analyzer/domain";
import { InMemoryAppSettingsStore } from "../test-support/in-memory-app-settings-store.js";
import type { SettingsSource } from "../services/config-check/settings-source.js";
import { COPILOT_CLI_FIXTURE_HOME, COPILOT_CLI_FIXTURE_SESSION_IDS, writeCopilotCliAgentHostStores } from "../test-support/copilot-cli-fixtures.js";
import { createExtensionApiService } from "./create-extension-api-service.js";

const fixturesRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures");

function buildService(appSettings = new InMemoryAppSettingsStore(), settingsSource?: SettingsSource, agentHostUserDataDir: string | null = null) {
  return createExtensionApiService({
    sessionStoreDbPath: path.join("/nonexistent", "state.vscdb"),
    debugLogsDirPaths: [],
    agentTracesDbPath: null,
    agentHostUserDataDir,
    copilotHome: null,
    vscodeSettingsPath: null,
    appSettings,
    settingsSource,
    learnScriptsDir: path.join(fixturesRoot, "learn-scripts"),
    vendorProfilesDir: path.join(fixturesRoot, "vendor-profiles"),
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
        vendorSimulation: true,
        // Step 15.14: Cost over time and Compare over the Copilot sessions;
        // no projects or billing here (D7, D19).
        costAnalysis: true,
        projectsAndBilling: false,
      },
    });
    expect(await service.getHealth()).toEqual({ status: "ok", version: "0.1.0-test" });
  });

  it("replays a Learn scenario on a model with VS Code wording (step 13.6)", async () => {
    const service = buildService();
    const session = await service.getScenario("clear", "claude-sonnet-5.5");
    expect(session.turns[0]!.simulation?.modelId).toBe("claude-sonnet-5.5");
    const comparison = await service.compareScenario("clear");
    expect(comparison.entries.length).toBeGreaterThan(1);
    expect((await service.listVendorProfiles()).length).toBe(6);
  });

  it("serves the cost analyses over the Copilot sessions, with no projects (step 15.14)", async () => {
    const service = buildService();

    const series = await service.getCostTimeSeries({ groupBy: "repository" });
    expect(series.groupBy).toBe("repository");
    const comparison = await service.getCostComparison({ groupBy: "repository", ids: "a,b", since: "2026-10-01", until: "2026-10-31" });
    expect(comparison.rows).toHaveLength(2);
    // Why a repository's cost changed (architecture.md §8, step 15.15).
    const variance = await service.getCostVariance({ groupBy: "repository", id: "github.com/example/app", periodA: "2026-09", periodB: "2026-10" });
    expect([variance.groupBy, variance.id, variance.basis]).toEqual(["repository", "github.com/example/app", "priced"]);
  });

  it("has no projects, statements, estimates or repository list in the extension (D7, D19)", async () => {
    const service = buildService();

    await expect(service.getProjectCost({ projectId: "portal" })).rejects.toThrow(/Unknown project id/);
    await expect(service.getStatement({ projectId: "portal", period: "2026-10" })).rejects.toThrow();
    await expect(service.getCostEstimate({ projectId: "portal", activeDays: "5" })).rejects.toThrow();
    await expect(service.getProjects()).rejects.toThrow();
    await expect(service.getRepositoryList()).rejects.toThrow();
  });

  it("lists only the VS Code provider", async () => {
    const status = await buildService().getLogProviderStatus();

    expect(status.activeProviderId).toBe("vscode");
    expect(status.providers.map((provider) => provider.id)).toEqual(["vscode"]);
  });

  it("serves Learn mode from the simulation: 17 scenarios on the default model (G4, D3, D13)", async () => {
    const service = buildService();
    const scenarios = await service.listLearnScenarios();

    expect(scenarios).toHaveLength(17);
    expect(scenarios.every((scenario) => scenario.mode === "learn")).toBe(true);
    expect(scenarios.every((s) => s.model === "claude-sonnet-5.5")).toBe(true);
    expect((await service.getLearnScenario("clear")).turns[0]!.simulation).toBeDefined();
    await expect(service.getLearnScenario("cache-ttl-1-hour-breakpoint")).rejects.toThrow();
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

  // Phase 14 step 14.5 (D5): the extension replays its Copilot sessions too,
  // priced from its bundled price book.
  describe("session replay", () => {
    function buildAgentHostService(userDataDir: string) {
      writeCopilotCliAgentHostStores(userDataDir);
      return createExtensionApiService({
        sessionStoreDbPath: null,
        debugLogsDirPaths: [],
        agentTracesDbPath: null,
        agentHostUserDataDir: userDataDir,
        copilotHome: COPILOT_CLI_FIXTURE_HOME,
        vscodeSettingsPath: null,
        appSettings: new InMemoryAppSettingsStore(),
        learnScriptsDir: path.join(fixturesRoot, "learn-scripts"),
        vendorProfilesDir: path.join(fixturesRoot, "vendor-profiles"),
        appVersion: "0.1.0-test",
      });
    }

    it("replays and compares a Copilot (Agent Host) session", async () => {
      const userDataDir = mkdtempSync(path.join(tmpdir(), "ext-replay-"));
      try {
        const service = buildAgentHostService(userDataDir);
        const sessionId = COPILOT_CLI_FIXTURE_SESSION_IDS.usageRecords;

        const replay = sessionReplaySchema.parse(await service.getSessionReplay(sessionId, { model: "claude-haiku-5.5" }));
        expect(replay).toMatchObject({ simulated: true, sessionId, providerId: "vscode", model: "claude-haiku-5.5" });
        const comparison = sessionReplayComparisonSchema.parse(await service.compareSessionReplay(sessionId, { models: ["claude-haiku-5.5", "gpt-6.1-sol"] }));
        expect(comparison.entries.map((entry) => entry.model)).toEqual(expect.arrayContaining(["claude-haiku-5.5", "gpt-6.1-sol"]));
        await expect(service.getSessionReplay("nope", { model: "claude-haiku-5.5" })).rejects.toThrow('Unknown session id "nope"');
      } finally {
        rmSync(userDataDir, { recursive: true, force: true });
      }
    });
  });
});
