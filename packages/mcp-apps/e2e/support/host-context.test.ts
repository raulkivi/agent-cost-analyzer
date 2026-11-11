// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hostContextFor, hostProfileFrom, webviewVariables, type HostRecording } from "./host-context.js";

// The shape of the A0 spike's recordings (docs/plans/mcp-apps-spike-results/).
const CLAUDE: HostRecording = {
  hostInfo: { name: "Claude", version: "1.0.0" },
  hostCapabilities: { openLinks: {}, serverTools: { listChanged: true }, message: { text: {} } },
  toolInfo: { present: true },
  displayModes: { current: "inline", available: ["inline", "fullscreen"] },
  otherHostContext: {
    containerDimensions: { maxHeight: 5000, width: 736 },
    locale: "en-US",
    timeZone: "Europe/Paris",
    platform: "desktop",
    deviceCapabilities: { touch: false, hover: true },
  },
};

const VSCODE: HostRecording = {
  hostInfo: { name: "Visual Studio Code - Insiders", version: "1.146.0-insider" },
  hostCapabilities: { serverTools: { listChanged: true } },
  toolInfo: { present: false },
  displayModes: { current: "inline", available: ["inline"] },
  otherHostContext: {
    containerDimensions: { maxHeight: 735.75, width: 877 },
    locale: "en-us",
    platform: "desktop",
    toolCall: { toolCallId: "call_1", toolName: "aca-spike-get_session_cost" },
  },
};

const DARK = { name: "Claude dark (recorded)", theme: "dark" as const, hostVars: { "--color-text-primary": "light-dark(#141413, #faf9f5)" } };
const TOOL = { name: "get_repository_cost", inputSchema: { type: "object" as const } };

describe("hostProfileFrom", () => {
  it("keeps the recorded host's name, capabilities and display modes", () => {
    const profile = hostProfileFrom(CLAUDE);
    expect(profile.hostInfo).toEqual({ name: "Claude", version: "1.0.0" });
    expect(profile.capabilities).toEqual(CLAUDE.hostCapabilities);
    expect(profile.availableDisplayModes).toEqual(["inline", "fullscreen"]);
  });

  it("names the tool the way the host did: toolInfo for Claude, a prefixed toolCall for VS Code", () => {
    expect(hostProfileFrom(CLAUDE).toolNaming).toEqual({ kind: "toolInfo" });
    expect(hostProfileFrom(VSCODE).toolNaming).toEqual({ kind: "toolCall", prefix: "aca-spike" });
  });
});

describe("hostContextFor", () => {
  it("sends the set's theme and variables with the recorded context and the tool that made the view", () => {
    const context = hostContextFor(hostProfileFrom(CLAUDE), DARK, { tool: TOOL, callId: "toolu_1" });
    expect(context).toEqual({
      theme: "dark",
      styles: { variables: DARK.hostVars },
      displayMode: "inline",
      availableDisplayModes: ["inline", "fullscreen"],
      containerDimensions: { maxHeight: 5000, width: 736 },
      locale: "en-US",
      timeZone: "Europe/Paris",
      platform: "desktop",
      deviceCapabilities: { touch: false, hover: true },
      toolInfo: { id: "toolu_1", tool: TOOL },
    });
  });

  it("names the tool in a VS Code toolCall with the server prefix, and no toolInfo", () => {
    const context = hostContextFor(hostProfileFrom(VSCODE), DARK, { tool: TOOL, callId: "call_2" });
    expect(context.toolCall).toEqual({ toolCallId: "call_2", toolName: "aca-spike-get_repository_cost" });
    expect(context.toolInfo).toBeUndefined();
  });

  it("takes a chosen width in place of the recorded one", () => {
    const context = hostContextFor(hostProfileFrom(CLAUDE), DARK, { tool: TOOL, callId: "t", width: 360 });
    expect(context.containerDimensions).toEqual({ maxHeight: 5000, width: 360 });
  });

  it("takes a display mode the host offers, and refuses one it does not", () => {
    expect(hostContextFor(hostProfileFrom(CLAUDE), DARK, { tool: TOOL, callId: "t", displayMode: "fullscreen" }).displayMode).toBe("fullscreen");
    expect(() => hostContextFor(hostProfileFrom(VSCODE), DARK, { tool: TOOL, callId: "t", displayMode: "fullscreen" })).toThrow(/does not offer fullscreen/);
  });

  it("never carries the recorded host's fonts, which load from the network", () => {
    const context = hostContextFor(hostProfileFrom(CLAUDE), DARK, { tool: TOOL, callId: "t" });
    expect(context.styles).not.toHaveProperty("css");
  });

  it("sends only the protocol's style variables: VS Code's own --vscode-* colours live in its webview, not in the host context", () => {
    const vscodeDark = { name: "VS Code Dark Modern", theme: "dark" as const, hostVars: { "--color-text-primary": "var(--vscode-foreground)", "--vscode-foreground": "#cccccc" } };
    const context = hostContextFor(hostProfileFrom(VSCODE), vscodeDark, { tool: TOOL, callId: "t" });
    expect(context.styles).toEqual({ variables: { "--color-text-primary": "var(--vscode-foreground)" } });
  });

  it("refuses a context the view's ext-apps would reject, instead of leaving the view waiting", () => {
    const odd = { ...DARK, hostVars: { "--not-a-host-variable": "red" } };
    expect(() => hostContextFor(hostProfileFrom(CLAUDE), odd, { tool: TOOL, callId: "t" })).toThrow(/not a valid MCP Apps host context/);
  });
});

describe("webviewVariables", () => {
  it("lists the --vscode-* colours a VS Code webview defines itself, and nothing for Claude", () => {
    expect(webviewVariables({ name: "VS Code", theme: "dark", hostVars: { "--color-text-primary": "var(--vscode-foreground)", "--vscode-foreground": "#cccccc" } })).toEqual({
      "--vscode-foreground": "#cccccc",
    });
    expect(webviewVariables(DARK)).toEqual({});
  });
});
