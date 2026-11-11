// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { MCP_SERVER_LABEL } from "../../../../src/mcp/mcp-server-definitions.js";
import { ANALYZER_TOOL_SET, COPILOT_E2E_AGENT, COPILOT_E2E_SETTINGS, copilotE2eAgentFile } from "./copilot-e2e-settings.mts";

describe("the real-Copilot suite's tool access (owner decision D6)", () => {
  it("never turns on global auto approve, in any form", () => {
    expect(COPILOT_E2E_SETTINGS).not.toHaveProperty("chat.tools.global.autoApprove");
  });

  it("turns off MCP server discovery from every other app's config, so only the analyzer's server is offered", () => {
    expect(COPILOT_E2E_SETTINGS["chat.mcp.discovery.enabled"]).toEqual({
      "claude-desktop": false,
      copilot: false,
      windsurf: false,
      "cursor-global": false,
      "cursor-workspace": false,
    });
  });

  it("never auto-approves a terminal command", () => {
    expect(COPILOT_E2E_SETTINGS["chat.tools.terminal.enableAutoApprove"]).toBe(false);
  });

  it("names the analyzer's tool set as VS Code derives it from the server's label", () => {
    expect(ANALYZER_TOOL_SET).toBe(MCP_SERVER_LABEL.toLowerCase().replace(/\s+/g, "-"));
  });

  it("chats through an agent whose only tools are the analyzer's MCP tools", () => {
    const file = copilotE2eAgentFile();

    expect(file.name).toBe(`${COPILOT_E2E_AGENT}.agent.md`);
    expect(file.content).toMatch(new RegExp(`^---\\nname: ${COPILOT_E2E_AGENT}\\n`));
    expect(file.content).toContain(`tools: ['${ANALYZER_TOOL_SET}/*']\n`);
    expect(file.content.match(/^tools:/gm)).toHaveLength(1);
  });

  it("keeps new chats on VS Code's local harness, where the test agent, the selected model and Copilot's debug log apply (1.146 defaults to the Copilot SDK harness)", () => {
    expect(COPILOT_E2E_SETTINGS["chat.defaultToCopilotHarness"]).toBe(false);
    // Otherwise 1.146 turns a local choice back into the Copilot SDK harness ("copilotPreference").
    expect(COPILOT_E2E_SETTINGS["chat.editor.preferCopilotHarness"]).toBe(false);
  });

  it("starts every new chat in the test agent: an empty chat falls back to this mode whenever the agent list refreshes", () => {
    expect(COPILOT_E2E_SETTINGS["chat.newSession.defaultMode"]).toBe(COPILOT_E2E_AGENT);
  });
});
