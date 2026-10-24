import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readVscodeSettings } from "./read-vscode-settings.js";

describe("readVscodeSettings", () => {
  let dir: string;
  let settingsPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "read-vscode-settings-test-"));
    settingsPath = path.join(dir, "settings.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns logging disabled and no retention override when settingsPath is null", () => {
    expect(readVscodeSettings(null)).toEqual({
      loggingEnabled: false,
      maxRetainedSessionLogs: null,
      agentTracesEnabled: false,
    });
  });

  it("parses a JSONC settings.json with comments and trailing commas", () => {
    writeFileSync(
      settingsPath,
      `{
        // enable rich usage logging
        "github.copilot.chat.agentDebugLog.fileLogging.enabled": true,
        "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs": 200,
      }`,
    );

    expect(readVscodeSettings(settingsPath)).toEqual({
      loggingEnabled: true,
      maxRetainedSessionLogs: 200,
      agentTracesEnabled: false,
    });
  });

  it("treats the setting as disabled when absent", () => {
    writeFileSync(settingsPath, "{}");

    expect(readVscodeSettings(settingsPath)).toEqual({
      loggingEnabled: false,
      maxRetainedSessionLogs: null,
      agentTracesEnabled: false,
    });
  });

  it("recognizes the deprecated agentDebugLog.enabled alias", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({ "github.copilot.chat.agentDebugLog.enabled": true }),
    );

    expect(readVscodeSettings(settingsPath).loggingEnabled).toBe(true);
  });

  it("returns maxRetainedSessionLogs null when the value isn't a number", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs":
          "200",
      }),
    );

    expect(readVscodeSettings(settingsPath).maxRetainedSessionLogs).toBeNull();
  });

  it("degrades to the 'not found' snapshot instead of throwing when the file can't be read", () => {
    // Simulates the TOCTOU gap: settingsPath exists at check time but the
    // read itself fails (e.g. deleted, permissions, or malformed JSONC).
    const unreadablePath = path.join(dir, "does-not-exist-when-read.json");

    expect(readVscodeSettings(unreadablePath)).toEqual({
      loggingEnabled: false,
      maxRetainedSessionLogs: null,
      agentTracesEnabled: false,
    });
  });

  it("degrades to the 'not found' snapshot when the file contents can't be parsed as JSONC", () => {
    writeFileSync(settingsPath, "{ this is not valid json ");

    expect(readVscodeSettings(settingsPath)).toEqual({
      loggingEnabled: false,
      maxRetainedSessionLogs: null,
      agentTracesEnabled: false,
    });
  });

  it("recognizes github.copilot.chat.otel.dbSpanExporter.enabled as agentTracesEnabled", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({ "github.copilot.chat.otel.dbSpanExporter.enabled": true }),
    );

    expect(readVscodeSettings(settingsPath).agentTracesEnabled).toBe(true);
  });

  it("treats agentTracesEnabled as false when the setting is present but not exactly true", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({ "github.copilot.chat.otel.dbSpanExporter.enabled": "true" }),
    );

    expect(readVscodeSettings(settingsPath).agentTracesEnabled).toBe(false);
  });
});
