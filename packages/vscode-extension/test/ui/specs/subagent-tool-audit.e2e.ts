// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Step 10.20 (ST12, plan section 7): subagent tool calls in the panel's Tool
// audit tab, in a real VS Code. The seeded classic session (AUDIT_RUNS_SESSION,
// the server's explore-linked audit fixture) has two main-agent calls, a read
// run (3 tool calls, 1 failed) and a run with no log (unread, with its reason).
import { browser, expect } from "@wdio/globals";
import { AUDIT_RUNS_SESSION } from "../../../scripts/ui-automation/ui-fixture.mts";
import { AnalyzerPanel } from "../support/analyzer-panel.js";
import { wdioVscodeHost as host } from "../support/vscode-host.js";

const panel = new AnalyzerPanel(host);

async function clickButton(label: RegExp): Promise<void> {
  const clicked = await browser.execute((source) => {
    const pattern = new RegExp(source);
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((candidate) => pattern.test((candidate.textContent ?? "").trim()));
    button?.click();
    return button !== undefined;
  }, label.source);
  if (!clicked) throw new Error(`No button ${label} in the panel`);
}

const callRows = () => browser.execute(() => document.querySelectorAll("table[aria-label='Tool calls'] tbody tr").length);

suite("Subagent tool calls in the Tool audit tab (step 10.20)", () => {
  suiteSetup(async () => {
    await host.waitForExtension();
    await panel.reset();
    await panel.openSession(AUDIT_RUNS_SESSION.id);
  });

  test("the tile says how many calls came from subagent runs, naming the unread one", async () => {
    await panel.inside(async (view) => {
      await view.chooseOption("Tool audit");
      await view.waitForText("incl. 3 calls from 1 of 2 subagent runs");
      await view.waitForText("Calls by agent");
    });
  });

  test("the Agent filter narrows the calls table: All, Main agent, Subagents", async () => {
    await panel.inside(async () => {
      await clickButton(/^✓ Succeeded/);
      await browser.waitUntil(async () => (await callRows()) === 5, { timeout: 30_000, timeoutMsg: "All did not list 5 calls" });
      await clickButton(/^Main agent$/);
      await browser.waitUntil(async () => (await callRows()) === 2, { timeout: 30_000, timeoutMsg: "Main agent did not list 2 calls" });
      await clickButton(/^Subagents$/);
      await browser.waitUntil(async () => (await callRows()) === 3, { timeout: 30_000, timeoutMsg: "Subagents did not list 3 calls" });
    });
  });

  test("the runs table shows the read run's calls and the unread run's reason, never 0", async () => {
    await panel.inside(async (view) => {
      await view.waitForText("Subagent runs");
      const runs = await browser.execute(() => {
        const rows = Array.from(document.querySelectorAll("table[aria-label='Subagent runs'] tbody tr"));
        return rows.map((row) => ({ text: (row as HTMLElement).innerText.replace(/\s+/g, " ").trim(), unread: row.classList.contains("audit-run--unread") }));
      });
      expect(runs).toHaveLength(2);
      expect(runs[0]?.unread).toBe(false);
      expect(runs[0]?.text).toContain("searchSubagent");
      expect(runs[0]?.text).toContain("33.3%");
      expect(runs[1]?.unread).toBe(true);
      expect(runs[1]?.text).toMatch(/writes no log the analyzer reads/);
      expect(runs[1]?.text).toContain("—");
    });
  });
});
