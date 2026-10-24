import { describe, expect, it } from "vitest";
import type { SettingsSource } from "./settings-source.js";

// Shared assertions every SettingsSource must satisfy: the standalone
// app's JSONC file reader and the extension's VS Code configuration reader
// run these same tests, so checkConfig can't tell them apart. `build`
// returns a source whose settings are exactly `values`.
export interface SettingsSourceContractFixture {
  build: (values: Record<string, unknown>) => SettingsSource;
}

export function describeSettingsSourceContract(label: string, fixture: SettingsSourceContractFixture): void {
  describe(`SettingsSource contract: ${label}`, () => {
    it("returns each configured value as it was set, whatever its type", () => {
      const source = fixture.build({
        "github.copilot.chat.agentDebugLog.fileLogging.enabled": true,
        "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs": 200,
        "some.other.setting": "text",
      });

      expect(source.get("github.copilot.chat.agentDebugLog.fileLogging.enabled")).toBe(true);
      expect(source.get("github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs")).toBe(200);
      expect(source.get("some.other.setting")).toBe("text");
    });

    it("keeps an explicit false, which is not the same as unset", () => {
      const source = fixture.build({ "github.copilot.chat.otel.dbSpanExporter.enabled": false });

      expect(source.get("github.copilot.chat.otel.dbSpanExporter.enabled")).toBe(false);
    });

    it("returns undefined for a setting that isn't set", () => {
      const source = fixture.build({});

      expect(source.get("github.copilot.chat.agentDebugLog.fileLogging.enabled")).toBeUndefined();
    });

    it("describes itself as located, with a settings path that is a string or null", () => {
      const description = fixture.build({}).describe();

      expect(description.located).toBe(true);
      expect(description.userSettingsPath === null || typeof description.userSettingsPath === "string").toBe(true);
    });
  });
}
