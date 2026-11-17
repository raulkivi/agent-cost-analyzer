// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Free demo scene E8, Failed tool calls and advice, on made-up data (`npm run demo:record`):
// Show Tool Audit from a session's context menu, the failure categories and Unknown
// outcomes, then the session with subagent runs (Agent filter: Subagents, the runs table
// with an unread run and its reason), the All sessions audit with the main/subagent
// split, and the Copy Advice Bundle dialog (previewed, then closed without copying).
// Beat list: docs/plans/demo-recordings-1.0.md §3.3 and D39.
import { browser, expect } from "@wdio/globals";
import { parseDemoFixture } from "../../../scripts/ui-automation/demo-fixture.mts";
import { AnalyzerPanel } from "../support/analyzer-panel.js";
import { SidebarViews } from "../support/sidebar-views.js";
import { wdioVscodeHost as host } from "../support/vscode-host.js";
import { runDemoScene, type DemoDriver, type DemoScene } from "./support/demo-driver.ts";
import { menuItem, openContextMenu, sessionRow } from "./support/1.6e-helpers.ts";
import { e8BeatMs } from "./support/e8-beats.mts";

const fixture = parseDemoFixture(process.env.AICA_DEMO_FIXTURE);
const panel = new AnalyzerPanel(host);
const sidebar = new SidebarViews();
const WAIT_MS = 30_000;
const tab = (label: string): string => `//label[contains(@class,'seg-opt')][normalize-space()='${label}']`;
const chip = (label: string): string => `//div[@aria-label='Agent']//button[normalize-space()='${label}']`;
const SUCCEEDED_CHIP = "//button[contains(@class,'filter-chip')][contains(normalize-space(),'Succeeded')]";
const RUNS_TABLE = "table[aria-label='Subagent runs']";

// Right-click the session's row and choose `item`.
async function fromContextMenu(driver: DemoDriver, title: string, item: string): Promise<void> {
  const row = await sessionRow(title);
  await driver.pointerTo(await row.getElement());
  // The tree recycles row elements while it repaints: take the row again just before the click.
  await openContextMenu(await sessionRow(title));
  const entry = await menuItem(item);
  await driver.click(await entry.getElement());
  await browser.action("pointer").move({ x: 760, y: 700 }).perform();
  const workbench = await browser.getWorkbench();
  await browser.waitUntil(async () => (await workbench.getAllWebviews()).length > 0, { timeout: WAIT_MS, timeoutMsg: "the panel did not open" });
}

// Texts of the Agent column's cells, one per row of the calls table.
const agentCells = (): Promise<string[]> =>
  browser.execute(() => {
    const headers = Array.from(document.querySelectorAll("table[aria-label='Tool calls'] thead th"));
    const column = headers.findIndex((th) => (th.textContent ?? "").trim() === "Agent");
    return Array.from(document.querySelectorAll("table[aria-label='Tool calls'] tbody tr")).map((row) => ((row.children[column] as HTMLElement | undefined)?.innerText ?? "").trim());
  });

const scene: DemoScene = {
  id: "E8",
  slug: "tool-audit",
  title: "Failed tool calls and advice",
  steps: [
    {
      label: "show the Sessions view",
      beatMs: e8BeatMs("show the Sessions view"),
      action: async () => {
        await host.command("workbench.view.extension.aiCreditsAnalyzer");
        await sidebar.showAlone("sessions");
        await sessionRow(fixture.auditSession.title);
        await sessionRow(fixture.readSession.title);
      },
    },
    {
      label: "Show Tool Audit from the context menu",
      beatMs: e8BeatMs("Show Tool Audit from the context menu"),
      action: async (driver) => {
        await fromContextMenu(driver, fixture.auditSession.title, "Show Tool Audit");
        await panel.inside((view) => view.waitForText("Retried commands"));
        await driver.probePrivacy();
      },
    },
    {
      label: "Show Tool Audit on the session with subagent runs",
      beatMs: e8BeatMs("Show Tool Audit on the session with subagent runs"),
      action: async (driver) => {
        await fromContextMenu(driver, fixture.readSession.title, "Show Tool Audit");
        const { calls, runs } = fixture.readSession.subagentAudit;
        await panel.inside((view) => view.waitForText(`incl. ${calls} calls from ${runs - fixture.readSession.subagentAudit.unread} of ${runs} subagent runs`));
      },
    },
    {
      label: "Agent: Subagents",
      beatMs: e8BeatMs("Agent: Subagents"),
      action: (driver) =>
        panel.inside(async () => {
          await driver.click(await (await browser.$(chip("Subagents"))).getElement());
          // The table lists failed calls by default: add the succeeded ones, so the Agent column has rows to read.
          await driver.click(await (await browser.$(SUCCEEDED_CHIP)).getElement());
          await browser.waitUntil(async () => {
            const cells = await agentCells();
            return cells.length === fixture.readSession.subagentAudit.calls && cells.every((cell) => cell !== "Main");
          }, { timeout: WAIT_MS, timeoutMsg: "the Subagents filter did not list exactly the subagent calls" });
        }),
    },
    {
      label: "the runs table: the unread run and its reason",
      beatMs: e8BeatMs("the runs table: the unread run and its reason"),
      action: (driver) =>
        panel.inside(async (view) => {
          const table = await (await browser.$(RUNS_TABLE)).getElement();
          await browser.execute((element: HTMLElement) => element.scrollIntoView({ block: "center", behavior: "instant" }), table as never);
          await driver.pointerTo(await (await browser.$(`${RUNS_TABLE} tr.audit-run--unread`)).getElement());
          await view.waitForText("writes no log");
        }),
    },
    {
      label: "All sessions audit",
      beatMs: e8BeatMs("All sessions audit"),
      action: async (driver) => {
        await panel.inside(async (view) => {
          await driver.click(await (await browser.$(tab("All sessions"))).getElement());
          await view.waitForText("All sessions");
          await view.waitForText("Subagent runs");
        });
        await driver.probePrivacy();
      },
    },
    {
      label: "Copy Advice Bundle: dialog",
      beatMs: e8BeatMs("Copy Advice Bundle: dialog"),
      // The take ran over 20 s with the preview, so the dialog is shown but not previewed (docs/plans/demo-recordings-1.0.md §3.3).
      action: async (driver) => {
        await fromContextMenu(driver, fixture.auditSession.title, "Copy Advice Bundle");
        await panel.inside((view) => view.waitForText("Export advice bundle"));
        await driver.probePrivacy();
      },
    },
    {
      label: "close the dialog without copying",
      beatMs: e8BeatMs("close the dialog without copying"),
      action: (driver) =>
        panel.inside(async () => {
          await driver.click(await (await browser.$("button=Close")).getElement());
        }),
    },
  ],
};

suite("Demo E8 tool audit (made-up data)", () => {
  test("E8 plays through the driver", async () => {
    await host.waitForExtension({ userDataDir: fixture.userDataDir });
    await panel.reset();
    const mp4 = await runDemoScene(scene, {
      assertEnd: () =>
        panel.inside(async (view) => {
          expect(await view.hasText("Export advice bundle")).toBe(false);
          expect(await browser.$("[role='dialog']").isExisting()).toBe(false);
        }),
    });
    console.log(`E8 master: ${mp4}`);
  });
});
