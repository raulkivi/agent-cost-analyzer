// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Reads Copilot's *Configure Tools* picker (check 2.1): the quick tree VS Code
// 1.145 opens from the chat input's tools button in agent mode. Its command
// (`workbench.action.chat.configureTools`, read from the bundled
// workbench.desktop.main.js) needs a chat widget in agent mode; the tree's top
// rows are buckets: Built-In, then one per MCP server under the server's label
// (a server whose tools VS Code has not read yet is still listed). No chat
// message is sent, so it costs no AI Credits. TDD exception: needs the real
// workbench.
import { browser } from "@wdio/globals";
import type { VscodeHost } from "../../support/vscode-host.js";

export const CONFIGURE_TOOLS_COMMAND = "workbench.action.chat.configureTools";
export const ANALYZER_SERVER_LABEL = "AI Credits Analyzer";

export class ConfigureToolsPicker {
  constructor(private readonly host: VscodeHost) {}

  // The picker's rows, opened and closed again. The command resolves only when
  // the picker closes, so it is not awaited.
  async rows(): Promise<string[]> {
    // Agent mode (the built-in agent), no query: nothing is sent.
    await this.host.command("workbench.action.chat.open", { mode: "agent" });
    void this.host.command(CONFIGURE_TOOLS_COMMAND).catch(() => undefined);
    try {
      await browser.waitUntil(async () => (await this.visibleRows()).length > 0, { timeout: 20_000, timeoutMsg: "the Configure Tools picker did not open (is the chat in agent mode?)" });
      // Rows are added as the tree fills; a short settle before reading.
      await browser.pause(500);
      return await this.visibleRows();
    } finally {
      await this.host.command("workbench.action.closeQuickOpen");
    }
  }

  // Polls the picker (reopened each time: it is built when it opens) until the
  // analyzer's server is (or is not) among its rows. When it is not, the rows
  // must still hold the built-in tools, so an empty or half-built picker is
  // never taken for "not listed".
  async waitUntilListed(listed: boolean): Promise<string[]> {
    let rows: string[] = [];
    await browser.waitUntil(
      async () => {
        rows = await this.rows();
        const has = rows.some((row) => row.includes(ANALYZER_SERVER_LABEL));
        return has === listed && (listed || rows.length > 0);
      },
      { timeout: 60_000, interval: 1000, timeoutMsg: `${ANALYZER_SERVER_LABEL} did ${listed ? "not appear in" : "not leave"} Copilot's Configure Tools picker` },
    );
    return rows;
  }

  private visibleRows(): Promise<string[]> {
    return browser.execute(() =>
      Array.from(document.querySelectorAll(".quick-input-widget .monaco-list-row")).map((row) => (row as HTMLElement).innerText.replace(/\s+/g, " ").trim()),
    );
  }
}
