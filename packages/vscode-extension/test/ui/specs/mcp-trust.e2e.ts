// Manual check 2.5 (docs/plans/vscode-extension-manual-checks.md): a folder
// opened in Restricted Mode whose own settings turn the MCP server on gets no
// server until it is trusted. wdio.conf.mts runs this spec in its own VS Code
// launch, with Workspace Trust enabled and that folder open. Driven in a real
// VS Code (step 10.16).
import { browser, expect } from "@wdio/globals";
import { INTERNAL_COMMAND_IDS } from "../../../src/diagnostics/test-hooks.js";
import { McpServerList } from "../support/mcp-server-list.js";
import { wdioVscodeHost as host } from "../support/vscode-host.js";

const servers = new McpServerList(host);

function isTrusted(): Promise<boolean> {
  return browser.executeWorkbench((vscode) => vscode.workspace.isTrusted);
}

suite("MCP server in Restricted Mode (check 2.5)", () => {
  suiteSetup(async () => {
    await host.waitForExtension();
  });

  test("2.5 offers no server while the folder is untrusted, and the server once it is trusted", async () => {
    // The folder's setting is true, the user setting is off, and the folder is untrusted.
    expect(await isTrusted()).toBe(false);
    expect(await host.hook<unknown[]>(INTERNAL_COMMAND_IDS.mcpServerDefinitions)).toEqual([]);
    expect(await servers.includesServer()).toBe(false);

    // Trust the folder in the Workspace Trust editor.
    void host.command("workbench.trust.manage").catch(() => undefined);
    await browser.waitUntil(
      () =>
        browser.execute(() => {
          const button = Array.from(document.querySelectorAll<HTMLElement>(".workspace-trust-editor .monaco-button")).find((element) => element.innerText.trim() === "Trust");
          button?.click();
          return button !== undefined;
        }),
      { timeout: 30_000, timeoutMsg: "the Workspace Trust editor has no Trust button" },
    );
    await browser.waitUntil(isTrusted, { timeout: 30_000, timeoutMsg: "the folder did not become trusted" });

    await servers.waitUntilListed(true);
    const definitions = await host.hook<{ label: string }[]>(INTERNAL_COMMAND_IDS.mcpServerDefinitions);
    expect(definitions.map((definition) => definition.label)).toEqual(["AI Credits Analyzer"]);
  });
});
