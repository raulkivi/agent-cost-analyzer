import { describe, expect, it } from "vitest";
import { describeSettingsSourceContract } from "@agent-cost-analyzer/server/src/services/config-check/settings-source-contract";
import { checkConfig } from "@agent-cost-analyzer/server/src/services/config-check/config-check";
import { VscodeSettingsSource, type ConfigurationReader } from "./vscode-settings-source.js";

// vscode.workspace.getConfiguration() as it behaves for a dotted id: the
// effective value, or undefined when nothing (not even a contributed
// default) is set.
function fakeConfiguration(values: Record<string, unknown>): ConfigurationReader {
  return { getConfiguration: () => ({ get: (section: string) => values[section] }) };
}

describeSettingsSourceContract("VscodeSettingsSource", {
  build: (values) => new VscodeSettingsSource(fakeConfiguration(values), "/u/User/settings.json"),
});

describe("VscodeSettingsSource (vscode-extension.md G6)", () => {
  it("reads the effective value on every call, so a later change (or a workspace override) is seen", () => {
    const values: Record<string, unknown> = { "a.b": 1 };
    const source = new VscodeSettingsSource(fakeConfiguration(values), null);

    expect(source.get("a.b")).toBe(1);

    values["a.b"] = 2;
    expect(source.get("a.b")).toBe(2);
  });

  it("is always located, and reports the user settings path it was given (or none)", () => {
    expect(new VscodeSettingsSource(fakeConfiguration({}), "/u/settings.json").describe()).toEqual({
      located: true,
      userSettingsPath: "/u/settings.json",
    });
    expect(new VscodeSettingsSource(fakeConfiguration({}), null).describe()).toEqual({ located: true, userSettingsPath: null });
  });

  it("makes the config status follow the effective setting, not the user file", () => {
    const values: Record<string, unknown> = {
      "github.copilot.chat.agentDebugLog.fileLogging.enabled": true,
      "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs": 200,
      "github.copilot.chat.otel.dbSpanExporter.enabled": true,
    };
    const source = new VscodeSettingsSource(fakeConfiguration(values), "/u/User/settings.json");
    expect(checkConfig({ settings: source }).warnings).toEqual([]);

    // A workspace-level override turns logging off.
    values["github.copilot.chat.agentDebugLog.fileLogging.enabled"] = false;

    const status = checkConfig({ settings: source });
    expect(status.loggingEnabled).toBe(false);
    expect(status.warnings.map((warning) => warning.code)).toEqual(["logging-disabled"]);
  });
});
