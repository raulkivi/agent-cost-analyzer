// Reads VS Code's own *MCP: List Servers* quick pick (step 10.16), the list a
// user sees in the workbench: what the extension's server definition provider
// shows once VS Code has taken its definitions. It needs no Copilot Chat.
import { browser } from "@wdio/globals";
import type { VscodeHost } from "./vscode-host.js";

export const MCP_LIST_SERVERS_COMMAND = "workbench.mcp.listServer";
export const MCP_SERVER_LABEL = "AI Credits Analyzer";

export class McpServerList {
  constructor(private readonly host: VscodeHost) {}

  // The quick pick's rows, opened and closed again. The command resolves only
  // when the pick closes, so it is not awaited.
  async rows(): Promise<string[]> {
    void this.host.command(MCP_LIST_SERVERS_COMMAND).catch(() => undefined);
    try {
      await browser.waitUntil(async () => (await this.visibleRows()).length > 0, { timeout: 15_000, timeoutMsg: "the MCP server list did not open" });
      return await this.visibleRows();
    } finally {
      await this.host.command("workbench.action.closeQuickOpen");
    }
  }

  async includesServer(): Promise<boolean> {
    return (await this.rows()).some((row) => row.includes(MCP_SERVER_LABEL));
  }

  // Polls the list until the server is (or is not) in it.
  async waitUntilListed(listed: boolean): Promise<void> {
    await browser.waitUntil(async () => (await this.includesServer()) === listed, {
      timeout: 45_000,
      interval: 1000,
      timeoutMsg: `${MCP_SERVER_LABEL} did not ${listed ? "appear in" : "leave"} VS Code's MCP server list`,
    });
  }

  private visibleRows(): Promise<string[]> {
    return browser.execute(() =>
      Array.from(document.querySelectorAll(".quick-input-list .monaco-list-row")).map((row) => (row as HTMLElement).innerText.replace(/\s+/g, " ").trim()),
    );
  }
}
