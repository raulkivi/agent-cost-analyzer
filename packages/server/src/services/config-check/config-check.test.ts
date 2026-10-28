import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configStatusSchema } from "@agent-cost-analyzer/domain";
import { checkConfig } from "./config-check.js";
import type { SettingsSource } from "./settings-source.js";

const NOW = () => "2026-08-08T00:00:00.000Z";

describe("checkConfig", () => {
  let dir: string;
  let settingsPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "config-check-test-"));
    settingsPath = path.join(dir, "settings.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("warns settings-not-found when no settings.json could be located", () => {
    const status = checkConfig({ settingsPath: null, now: NOW });

    expect(() => configStatusSchema.parse(status)).not.toThrow();
    expect(status.vscodeUserSettingsPath).toBeNull();
    expect(status.warnings).toEqual([
      expect.objectContaining({ code: "settings-not-found" }),
    ]);
  });

  it("warns logging-disabled when the setting is off, retention is fine", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        "github.copilot.chat.agentDebugLog.fileLogging.enabled": false,
        "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs": 200,
        "github.copilot.chat.otel.dbSpanExporter.enabled": true,
      }),
    );

    const status = checkConfig({ settingsPath, now: NOW });

    expect(status.warnings).toEqual([
      expect.objectContaining({
        code: "logging-disabled",
        settingId: "github.copilot.chat.agentDebugLog.fileLogging.enabled",
        currentValue: false,
        recommendedValue: true,
      }),
    ]);
  });

  it("warns retention-too-low using the VS Code default (50) when unset", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        "github.copilot.chat.agentDebugLog.fileLogging.enabled": true,
        "github.copilot.chat.otel.dbSpanExporter.enabled": true,
      }),
    );

    const status = checkConfig({ settingsPath, now: NOW });

    expect(status.warnings).toEqual([
      expect.objectContaining({
        code: "retention-too-low",
        settingId:
          "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs",
        currentValue: 50,
        recommendedValue: 200,
      }),
    ]);
  });

  it("warns retention-too-low when explicitly set below 200", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        "github.copilot.chat.agentDebugLog.fileLogging.enabled": true,
        "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs": 100,
        "github.copilot.chat.otel.dbSpanExporter.enabled": true,
      }),
    );

    const status = checkConfig({ settingsPath, now: NOW });

    expect(status.warnings).toEqual([
      expect.objectContaining({ code: "retention-too-low", currentValue: 100 }),
    ]);
  });

  it("has no warnings when logging is enabled, retention is at least 200, and agent-traces is enabled", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        "github.copilot.chat.agentDebugLog.fileLogging.enabled": true,
        "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs": 200,
        "github.copilot.chat.otel.dbSpanExporter.enabled": true,
      }),
    );

    const status = checkConfig({ settingsPath, now: NOW });

    expect(status.warnings).toEqual([]);
    expect(status.loggingEnabled).toBe(true);
    expect(status.maxRetainedSessionLogs).toBe(200);
  });

  it("stamps checkedAt from the injected clock", () => {
    const status = checkConfig({ settingsPath: null, now: NOW });

    expect(status.checkedAt).toBe("2026-08-08T00:00:00.000Z");
  });

  it("every warning declares an explicit severity, valid against the domain schema", () => {
    const status = checkConfig({ settingsPath: null, now: NOW });

    expect(() => configStatusSchema.parse(status)).not.toThrow();
    for (const warning of status.warnings) {
      expect(["required", "optional"]).toContain(warning.severity);
    }
  });

  it("warns agent-traces-unavailable (optional severity) when the otel setting is off", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        "github.copilot.chat.agentDebugLog.fileLogging.enabled": true,
        "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs": 200,
      }),
    );

    const status = checkConfig({ settingsPath, now: NOW });

    expect(status.warnings).toEqual([
      expect.objectContaining({
        code: "agent-traces-unavailable",
        severity: "optional",
        settingId: "github.copilot.chat.otel.dbSpanExporter.enabled",
        currentValue: false,
        recommendedValue: true,
      }),
    ]);
  });

  it("does not double-warn agent-traces-unavailable when settings.json itself couldn't be found", () => {
    const status = checkConfig({ settingsPath: null, now: NOW });

    expect(status.warnings).toEqual([
      expect.objectContaining({ code: "settings-not-found" }),
    ]);
  });

  it("falls back to 200 when no threshold is injected", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        "github.copilot.chat.agentDebugLog.fileLogging.enabled": true,
        "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs": 200,
        "github.copilot.chat.otel.dbSpanExporter.enabled": true,
      }),
    );

    const status = checkConfig({ settingsPath, now: NOW });

    expect(status.minRetainedSessionLogsThreshold).toBe(200);
  });

  it("warns retention-too-low against a custom threshold above the current value", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        "github.copilot.chat.agentDebugLog.fileLogging.enabled": true,
        "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs": 200,
        "github.copilot.chat.otel.dbSpanExporter.enabled": true,
      }),
    );

    const status = checkConfig({
      settingsPath,
      now: NOW,
      minRetainedSessionLogsThreshold: 300,
    });

    expect(status.minRetainedSessionLogsThreshold).toBe(300);
    expect(status.warnings).toEqual([
      expect.objectContaining({
        code: "retention-too-low",
        currentValue: 200,
        recommendedValue: 300,
      }),
    ]);
  });

  it("does not warn retention-too-low when the current value meets a custom threshold", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        "github.copilot.chat.agentDebugLog.fileLogging.enabled": true,
        "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs": 200,
        "github.copilot.chat.otel.dbSpanExporter.enabled": true,
      }),
    );

    const status = checkConfig({
      settingsPath,
      now: NOW,
      minRetainedSessionLogsThreshold: 100,
    });

    expect(status.minRetainedSessionLogsThreshold).toBe(100);
    expect(status.warnings).toEqual([]);
  });

  it("includes minRetainedSessionLogsThreshold in the zero-warnings case", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        "github.copilot.chat.agentDebugLog.fileLogging.enabled": true,
        "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs": 200,
        "github.copilot.chat.otel.dbSpanExporter.enabled": true,
      }),
    );

    const status = checkConfig({
      settingsPath,
      now: NOW,
      minRetainedSessionLogsThreshold: 200,
    });

    expect(() => configStatusSchema.parse(status)).not.toThrow();
    expect(status.minRetainedSessionLogsThreshold).toBe(200);
  });

  it("includes minRetainedSessionLogsThreshold in the settings-not-found branch", () => {
    const status = checkConfig({
      settingsPath: null,
      now: NOW,
      minRetainedSessionLogsThreshold: 300,
    });

    expect(() => configStatusSchema.parse(status)).not.toThrow();
    expect(status.minRetainedSessionLogsThreshold).toBe(300);
  });

  describe("with an injected SettingsSource (vscode-extension.md G6)", () => {
    function source(values: Record<string, unknown>, userSettingsPath: string | null = "/u/settings.json", located = true): SettingsSource {
      return { get: (id) => values[id], describe: () => ({ located, userSettingsPath }) };
    }

    const GOOD = {
      "github.copilot.chat.agentDebugLog.fileLogging.enabled": true,
      "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs": 200,
      "github.copilot.chat.otel.dbSpanExporter.enabled": true,
    };

    it("judges the source's values and reports its settings path", () => {
      const status = checkConfig({ settings: source(GOOD), now: NOW });

      expect(() => configStatusSchema.parse(status)).not.toThrow();
      expect(status.warnings).toEqual([]);
      expect(status.loggingEnabled).toBe(true);
      expect(status.maxRetainedSessionLogs).toBe(200);
      expect(status.vscodeUserSettingsPath).toBe("/u/settings.json");
    });

    it("applies the same rules: disabled logging, low retention and the optional agent-traces setting", () => {
      const status = checkConfig({
        settings: source({ "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs": 100 }),
        now: NOW,
      });

      expect(status.warnings.map((warning) => warning.code)).toEqual([
        "logging-disabled",
        "retention-too-low",
        "agent-traces-unavailable",
      ]);
      expect(status.warnings[0]?.helpSteps[0]).toContain("/u/settings.json");
    });

    it("warns copilot-chat-unavailable first when the source reports Copilot Chat as disabled or missing", () => {
      const status = checkConfig({
        settings: {
          get: (id) => GOOD[id as keyof typeof GOOD],
          describe: () => ({ located: true, userSettingsPath: "/u/settings.json", copilotChatAvailable: false }),
        },
        now: NOW,
      });

      expect(() => configStatusSchema.parse(status)).not.toThrow();
      expect(status.warnings).toEqual([
        expect.objectContaining({
          code: "copilot-chat-unavailable",
          severity: "required",
          settingId: "github.copilot.chat.agentDebugLog.fileLogging.enabled",
          currentValue: false,
          recommendedValue: true,
        }),
      ]);
    });

    it("keeps the other warnings after copilot-chat-unavailable", () => {
      const status = checkConfig({
        settings: {
          get: () => undefined,
          describe: () => ({ located: true, userSettingsPath: "/u/settings.json", copilotChatAvailable: false }),
        },
        now: NOW,
      });

      expect(status.warnings.map((warning) => warning.code)).toEqual([
        "copilot-chat-unavailable",
        "logging-disabled",
        "retention-too-low",
        "agent-traces-unavailable",
      ]);
    });

    it.each([true, undefined])("adds no copilot-chat-unavailable warning when copilotChatAvailable is %s", (copilotChatAvailable) => {
      const status = checkConfig({
        settings: { get: (id) => GOOD[id as keyof typeof GOOD], describe: () => ({ located: true, userSettingsPath: null, copilotChatAvailable }) },
        now: NOW,
      });

      expect(status.warnings).toEqual([]);
    });

    it("honours the deprecated logging alias", () => {
      const status = checkConfig({
        settings: source({ ...GOOD, "github.copilot.chat.agentDebugLog.fileLogging.enabled": undefined, "github.copilot.chat.agentDebugLog.enabled": true }),
        now: NOW,
      });

      expect(status.loggingEnabled).toBe(true);
    });

    it("ignores a non-numeric retention value, like the file reader does", () => {
      const status = checkConfig({
        settings: source({ ...GOOD, "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs": "lots" }),
        now: NOW,
      });

      expect(status.maxRetainedSessionLogs).toBeNull();
      expect(status.warnings.map((warning) => warning.code)).toEqual(["retention-too-low"]);
    });

    it("warns settings-not-found when the source couldn't locate any settings", () => {
      const status = checkConfig({ settings: source({}, null, false), now: NOW });

      expect(status.warnings.map((warning) => warning.code)).toEqual(["settings-not-found"]);
      expect(status.vscodeUserSettingsPath).toBeNull();
    });

    it("points help steps at a generic settings.json when the source has values but no known path", () => {
      const status = checkConfig({ settings: source({}, null, true), now: NOW });

      expect(status.vscodeUserSettingsPath).toBeNull();
      expect(status.warnings.map((warning) => warning.code)).toContain("logging-disabled");
      expect(status.warnings[0]?.helpSteps[0]).toContain("settings.json");
      expect(status.warnings[0]?.helpSteps[0]).not.toContain("null");
    });

    it("shows a settings path under the home directory as ~ in help steps only", () => {
      const homeDir = "/home/alice";
      const userSettingsPath = "/home/alice/.config/Code/User/settings.json";

      const status = checkConfig({
        settings: source({}, userSettingsPath, true),
        homeDir,
        now: NOW,
      });

      expect(status.vscodeUserSettingsPath).toBe(userSettingsPath);
      for (const warning of status.warnings) {
        const text = warning.helpSteps.join("\n");
        expect(text).not.toContain(homeDir);
      }
      expect(status.warnings[0]?.helpSteps[0]).toContain("~/.config/Code/User/settings.json");
    });

    it("uses the source in preference to settingsPath", () => {
      writeFileSync(settingsPath, JSON.stringify({}));

      const status = checkConfig({ settings: source(GOOD), settingsPath, now: NOW });

      expect(status.warnings).toEqual([]);
    });
  });

  describe("with an Agent Host catalog present", () => {
    const classicOffSettings = {
      "github.copilot.chat.agentDebugLog.fileLogging.enabled": false,
      "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs": 10,
      "github.copilot.chat.otel.dbSpanExporter.enabled": false,
    };

    it("downgrades the classic logging warnings to optional Local-harness wording", () => {
      writeFileSync(settingsPath, JSON.stringify(classicOffSettings));

      const status = checkConfig({ settingsPath, now: NOW, agentHostCatalogPresent: () => true });

      expect(status.warnings.map((w) => [w.code, w.severity])).toEqual([
        ["logging-disabled", "optional"],
        ["retention-too-low", "optional"],
        ["agent-traces-unavailable", "optional"],
      ]);
      for (const warning of status.warnings) {
        expect(warning.message).toContain("Local harness");
      }
    });

    it("keeps settings-not-found and copilot-chat-unavailable required", () => {
      expect(
        checkConfig({ settingsPath: null, now: NOW, agentHostCatalogPresent: () => true }).warnings,
      ).toEqual([expect.objectContaining({ code: "settings-not-found", severity: "required" })]);
    });

    it("keeps the warnings required when no catalog exists", () => {
      writeFileSync(settingsPath, JSON.stringify(classicOffSettings));

      const status = checkConfig({ settingsPath, now: NOW, agentHostCatalogPresent: () => false });

      expect(status.warnings.map((w) => [w.code, w.severity])).toEqual([
        ["logging-disabled", "required"],
        ["retention-too-low", "required"],
        ["agent-traces-unavailable", "optional"],
      ]);
    });
  });
});
