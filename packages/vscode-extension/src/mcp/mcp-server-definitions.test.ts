import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ConfigurationChangeEvent } from "../config/config-change-watcher.js";
import {
  MCP_ENABLED_SETTING_ID,
  McpServerDefinitionSource,
  mcpServerDefinitions,
  type McpServerDefinitionInput,
} from "./mcp-server-definitions.js";

const EXTENSION_PATH = path.join(path.sep, "ext", "raulkivi.ai-credits-analyzer-0.1.0");
const USER_DATA_DIR = path.join(path.sep, "home", "u", ".config", "Code");
const EXEC_PATH = path.join(path.sep, "opt", "code", "code");

const input: McpServerDefinitionInput = {
  enabled: true,
  userDataDir: USER_DATA_DIR,
  extensionPath: EXTENSION_PATH,
  execPath: EXEC_PATH,
  version: "0.1.0",
};

describe("mcpServerDefinitions (vscode-extension.md D7)", () => {
  it("defines one stdio server, run by VS Code's own Electron as Node, when the setting is on", () => {
    expect(mcpServerDefinitions(input)).toEqual([
      {
        label: "AI Credits Analyzer",
        command: EXEC_PATH,
        args: [path.join(EXTENSION_PATH, "dist", "mcp-stdio.js"), "--user-data-dir", USER_DATA_DIR],
        env: { ELECTRON_RUN_AS_NODE: "1" },
        version: "0.1.0",
      },
    ]);
  });

  it.each([
    ["off", false],
    ["unset", undefined],
    ["the string 'true'", "true"],
    ["1", 1],
  ])("defines no server when the setting is %s", (_label, enabled) => {
    expect(mcpServerDefinitions({ ...input, enabled })).toEqual([]);
  });

  it("defines no server when the user-data dir couldn't be derived", () => {
    expect(mcpServerDefinitions({ ...input, userDataDir: null })).toEqual([]);
  });
});

function fakeWorkspace(settings: Record<string, unknown>) {
  const listeners = new Set<(event: ConfigurationChangeEvent) => void>();
  return {
    getConfiguration: () => ({ get: (section: string) => settings[section] }),
    onDidChangeConfiguration(listener: (event: ConfigurationChangeEvent) => void) {
      listeners.add(listener);
      return { dispose: () => void listeners.delete(listener) };
    },
    change(ids: string[]) {
      const event = { affectsConfiguration: (section: string) => ids.some((id) => id === section || id.startsWith(`${section}.`)) };
      for (const listener of [...listeners]) listener(event);
    },
    listenerCount: () => listeners.size,
  };
}

function source(settings: Record<string, unknown>, userDataDir: string | null = USER_DATA_DIR) {
  const workspace = fakeWorkspace(settings);
  const warnings: string[] = [];
  const definitions = new McpServerDefinitionSource({
    workspace,
    userDataDir,
    extensionPath: EXTENSION_PATH,
    execPath: EXEC_PATH,
    version: "0.1.0",
    onWarning: (message) => warnings.push(message),
  });
  return { workspace, warnings, definitions };
}

describe("McpServerDefinitionSource", () => {
  it("reads the setting on every request, so a change applies without a reload", () => {
    const settings: Record<string, unknown> = {};
    const { definitions } = source(settings);
    expect(definitions.provide()).toEqual([]);

    settings[MCP_ENABLED_SETTING_ID] = true;

    expect(definitions.provide()).toHaveLength(1);
  });

  it("signals a change when the MCP setting changes, and only then", () => {
    const { workspace, definitions } = source({});
    let changes = 0;
    definitions.onDidChange(() => changes++);

    workspace.change(["editor.fontSize", "github.copilot.chat.agentDebugLog.fileLogging.enabled"]);
    expect(changes).toBe(0);

    workspace.change([MCP_ENABLED_SETTING_ID]);
    expect(changes).toBe(1);
  });

  it("logs once, not on every request, when the setting is on but the user-data dir is unknown", () => {
    const { warnings, definitions } = source({ [MCP_ENABLED_SETTING_ID]: true }, null);

    expect(definitions.provide()).toEqual([]);
    expect(definitions.provide()).toEqual([]);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/MCP server.*user-data dir/);
  });

  it("logs nothing while the setting is off", () => {
    const { warnings, definitions } = source({}, null);

    definitions.provide();

    expect(warnings).toEqual([]);
  });

  it("stops listening for setting changes when disposed", () => {
    const { workspace, definitions } = source({});
    let changes = 0;
    const subscription = definitions.onDidChange(() => changes++);
    expect(workspace.listenerCount()).toBe(1);

    subscription.dispose();
    definitions.dispose();
    workspace.change([MCP_ENABLED_SETTING_ID]);

    expect(changes).toBe(0);
    expect(workspace.listenerCount()).toBe(0);
  });
});
