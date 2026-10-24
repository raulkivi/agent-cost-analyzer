import { describe, expect, it } from "vitest";
import { configStatusSchema } from "./config-status.js";

describe("configStatusSchema", () => {
  it("accepts a clean status with no warnings", () => {
    const sample = {
      checkedAt: "2026-08-08T00:00:00.000Z",
      vscodeUserSettingsPath: "/home/user/.config/Code/User/settings.json",
      loggingEnabled: true,
      maxRetainedSessionLogs: 200,
      minRetainedSessionLogsThreshold: 200,
      warnings: [],
    };

    expect(configStatusSchema.parse(sample)).toEqual(sample);
  });

  it("accepts a status with unresolved settings path and warnings", () => {
    const sample = {
      checkedAt: "2026-08-08T00:00:00.000Z",
      vscodeUserSettingsPath: null,
      loggingEnabled: false,
      maxRetainedSessionLogs: null,
      minRetainedSessionLogsThreshold: 200,
      warnings: [
        {
          code: "settings-not-found",
          severity: "required",
          settingId: "github.copilot.chat.agentDebugLog.fileLogging.enabled",
          currentValue: null,
          recommendedValue: true,
          message: "Could not locate settings.json.",
          helpSteps: ["Confirm VS Code is installed"],
        },
      ],
    };

    expect(configStatusSchema.parse(sample)).toEqual(sample);
  });

  it("rejects a status missing minRetainedSessionLogsThreshold", () => {
    const sample = {
      checkedAt: "2026-08-08T00:00:00.000Z",
      vscodeUserSettingsPath: "/home/user/.config/Code/User/settings.json",
      loggingEnabled: true,
      maxRetainedSessionLogs: 200,
      warnings: [],
    };

    expect(() => configStatusSchema.parse(sample)).toThrow();
  });
});
