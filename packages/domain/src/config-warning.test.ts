import { describe, expect, it } from "vitest";
import { configWarningSchema } from "./config-warning.js";

describe("configWarningSchema", () => {
  it("accepts a required-severity logging-disabled warning", () => {
    const sample = {
      code: "logging-disabled",
      severity: "required",
      settingId: "github.copilot.chat.agentDebugLog.fileLogging.enabled",
      currentValue: false,
      recommendedValue: true,
      message: "Usage token logging is disabled.",
      helpSteps: ["Set the setting to true in settings.json", "Reload VS Code"],
    };

    expect(configWarningSchema.parse(sample)).toEqual(sample);
  });

  // Phase 8.5: agent-traces.db is an optional enrichment, not a blocking
  // prerequisite like the other three codes — severity distinguishes it in
  // the frontend banner (ConfigWarningBanner.tsx).
  it("accepts an optional-severity agent-traces-unavailable warning", () => {
    const sample = {
      code: "agent-traces-unavailable",
      severity: "optional",
      settingId: "github.copilot.chat.otel.dbSpanExporter.enabled",
      currentValue: false,
      recommendedValue: true,
      message: "Cache-write and reasoning-token counts aren't available yet.",
      helpSteps: ["Set the setting to true in settings.json", "Reload VS Code"],
    };

    expect(configWarningSchema.parse(sample)).toEqual(sample);
  });

  it("rejects an invalid code", () => {
    const sample = {
      code: "not-a-real-code",
      severity: "required",
      settingId: "some.setting",
      currentValue: false,
      recommendedValue: true,
      message: "message",
      helpSteps: [],
    };

    expect(() => configWarningSchema.parse(sample)).toThrow();
  });

  it("rejects a missing severity", () => {
    const sample = {
      code: "logging-disabled",
      settingId: "some.setting",
      currentValue: false,
      recommendedValue: true,
      message: "message",
      helpSteps: [],
    };

    expect(() => configWarningSchema.parse(sample)).toThrow();
  });

  it("rejects an invalid severity", () => {
    const sample = {
      code: "logging-disabled",
      severity: "urgent",
      settingId: "some.setting",
      currentValue: false,
      recommendedValue: true,
      message: "message",
      helpSteps: [],
    };

    expect(() => configWarningSchema.parse(sample)).toThrow();
  });
});
