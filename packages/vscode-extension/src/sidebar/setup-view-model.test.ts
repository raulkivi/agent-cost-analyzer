import type { ConfigStatus, ConfigWarning } from "@copilot-cost-analyzer/domain";
import { describe, expect, it } from "vitest";
import { buildSetupTree } from "./setup-view-model.js";

function warning(overrides: Partial<ConfigWarning>): ConfigWarning {
  return {
    code: "logging-disabled",
    severity: "required",
    settingId: "github.copilot.chat.agentDebugLog.fileLogging.enabled",
    currentValue: false,
    recommendedValue: true,
    message: "Copilot Chat debug logging is off, so new chat sessions record no token or AI Credits data.",
    helpSteps: ["Set fileLogging.enabled to true"],
    ...overrides,
  };
}

function status(warnings: ConfigWarning[]): ConfigStatus {
  return {
    checkedAt: "2026-10-24T00:00:00.000Z",
    vscodeUserSettingsPath: null,
    loggingEnabled: warnings.length === 0,
    maxRetainedSessionLogs: 200,
    minRetainedSessionLogsThreshold: 200,
    warnings,
  };
}

describe("buildSetupTree", () => {
  it("has no nodes when nothing needs fixing, so the view's welcome content shows", () => {
    expect(buildSetupTree(status([]))).toEqual([]);
  });

  it("has no nodes before the first status is known", () => {
    expect(buildSetupTree(undefined)).toEqual([]);
  });

  it("makes one node per warning, in order, each carrying the setting to fix", () => {
    const tree = buildSetupTree(
      status([
        warning({}),
        warning({
          code: "retention-too-low",
          settingId: "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs",
          message: "Only the last 50 sessions' logs are retained on disk.",
        }),
      ]),
    );

    expect(tree.map((node) => node.settingId)).toEqual([
      "github.copilot.chat.agentDebugLog.fileLogging.enabled",
      "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs",
    ]);
    expect(tree.map((node) => node.label)).toEqual([
      "Copilot Chat debug logging is off, so new chat sessions record no token or AI Credits data.",
      "Only the last 50 sessions' logs are retained on disk.",
    ]);
  });

  it("gives each node an id from the warning's code and setting, so tree items never collide", () => {
    const tree = buildSetupTree(
      status([warning({}), warning({ code: "retention-too-low" }), warning({ code: "retention-too-low" })]),
    );

    expect(tree.slice(0, 2).map((node) => node.id)).toEqual([
      "logging-disabled:github.copilot.chat.agentDebugLog.fileLogging.enabled",
      "retention-too-low:github.copilot.chat.agentDebugLog.fileLogging.enabled",
    ]);
  });

  it("marks a required warning with the warning icon and the word 'Required'", () => {
    const [node] = buildSetupTree(status([warning({ severity: "required" })]));

    expect(node).toMatchObject({ kind: "warning", icon: "warning", description: "Required" });
  });

  it("marks an optional warning with the info icon and the word 'Optional' (never colour alone)", () => {
    const [node] = buildSetupTree(status([warning({ code: "agent-traces-unavailable", severity: "optional" })]));

    expect(node).toMatchObject({ icon: "info", description: "Optional" });
  });

  it("lists the help steps in the tooltip and puts severity and message in the screen-reader label", () => {
    const [node] = buildSetupTree(status([warning({ helpSteps: ["Open Settings", "Turn it on"], message: "Logging is off." })]));

    expect(node?.tooltip).toBe("Logging is off.\n\n1. Open Settings\n2. Turn it on");
    expect(node?.ariaLabel).toBe("Required: Logging is off.");
  });

  it("leaves the steps out of the tooltip when there are none", () => {
    const [node] = buildSetupTree(status([warning({ helpSteps: [], message: "Logging is off." })]));

    expect(node?.tooltip).toBe("Logging is off.");
  });
});
