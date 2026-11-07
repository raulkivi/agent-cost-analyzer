// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Manual checks 2.1, 2.2 and 2.6 (docs/plans/vscode-extension-manual-checks.md)
// at the level VS Code shows them: its own *MCP: List Servers* pick. That the
// server lists 19 tools and answers is the integration suite's (over stdio);
// Copilot agent mode using them (2.3, 2.4) stays manual.
import { expect } from "@wdio/globals";
import { INTERNAL_COMMAND_IDS } from "../../../src/diagnostics/test-hooks.js";
import { McpServerList } from "../support/mcp-server-list.js";
import { wdioVscodeHost as host } from "../support/vscode-host.js";

const MCP_SETTING = "aiCreditsAnalyzer.mcp.enabled";
const servers = new McpServerList(host);

suite("MCP server setting (checks 2.1, 2.2, 2.6)", () => {
  suiteSetup(async () => {
    await host.waitForExtension();
  });

  suiteTeardown(async () => {
    await host.setSetting(MCP_SETTING, false);
  });

  test("2.1 with the setting off (the default), VS Code lists no AI Credits Analyzer server", async () => {
    await host.setSetting(MCP_SETTING, false);

    expect(await host.hook<unknown[]>(INTERNAL_COMMAND_IDS.mcpServerDefinitions)).toEqual([]);
    expect(await servers.includesServer()).toBe(false);
  });

  test("2.2 turning the setting on in User settings makes VS Code list the server", async () => {
    await host.setSetting(MCP_SETTING, true);

    await servers.waitUntilListed(true);
    const definitions = await host.hook<{ label: string }[]>(INTERNAL_COMMAND_IDS.mcpServerDefinitions);
    expect(definitions.map((definition) => definition.label)).toEqual(["AI Credits Analyzer"]);
  });

  test("2.6 turning the setting off again removes the server from the list", async () => {
    await host.setSetting(MCP_SETTING, false);

    await servers.waitUntilListed(false);
    expect(await host.hook<unknown[]>(INTERNAL_COMMAND_IDS.mcpServerDefinitions)).toEqual([]);
  });
});
