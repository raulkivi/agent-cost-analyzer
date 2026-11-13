// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Free demo scene E8, Failed tool calls and advice, on made-up data (`npm run demo:record`):
// Show Tool Audit from a session's context menu, the failure categories and Unknown
// outcomes, the All sessions audit, and the Copy Advice Bundle dialog (previewed, then
// closed without copying).
import { browser, expect } from "@wdio/globals";
import { parseDemoFixture } from "../../../scripts/ui-automation/demo-fixture.mts";
import { AnalyzerPanel } from "../support/analyzer-panel.js";
import { SidebarViews } from "../support/sidebar-views.js";
import { wdioVscodeHost as host } from "../support/vscode-host.js";
import { runDemoScene, type DemoDriver, type DemoScene } from "./support/demo-driver.ts";
import { installWorkbenchPointer, menuItem, openContextMenu, sessionRow, showPointerIn } from "./support/1.6e-helpers.ts";

const fixture = parseDemoFixture(process.env.AICA_DEMO_FIXTURE);
const panel = new AnalyzerPanel(host);
const sidebar = new SidebarViews();
const tab = (label: string): string => `//label[contains(@class,'seg-opt')][normalize-space()='${label}']`;

// Right-click the audit session's row and choose `item`.
async function fromContextMenu(driver: DemoDriver, item: string): Promise<void> {
  await showPointerIn("workbench");
  const row = await sessionRow(fixture.auditSession.title);
  await driver.pointerTo(await row.getElement());
  // The tree recycles row elements while it repaints: take the row again just before the click.
  await openContextMenu(await sessionRow(fixture.auditSession.title));
  const entry = await menuItem(item);
  // Menu items act on mouse-up, so this is a driver (native) click, after the glide and ripple.
  await driver.pointerTo(await entry.getElement());
  await browser.execute(() => window.__demoPointer.ripple());
  await browser.pause(150);
  await entry.click();
  // The real mouse stays over the menu item's spot, where it would hover a tree row (a tooltip in the take).
  await browser.action("pointer").move({ x: 760, y: 700 }).perform();
  const workbench = await browser.getWorkbench();
  await browser.waitUntil(async () => (await workbench.getAllWebviews()).length > 0, { timeout: 30_000, timeoutMsg: "the panel did not open" });
  await showPointerIn("webview");
}

const scene: DemoScene = {
  id: "E8",
  slug: "tool-audit",
  title: "Failed tool calls and advice",
  steps: [
    {
      label: "show the Sessions view",
      beatMs: 600,
      action: async () => {
        await installWorkbenchPointer();
        await host.command("workbench.view.extension.aiCreditsAnalyzer");
        await sidebar.showAlone("sessions");
        await sessionRow(fixture.auditSession.title);
      },
    },
    {
      label: "Show Tool Audit from the context menu",
      beatMs: 1_800,
      action: async (driver) => {
        await fromContextMenu(driver, "Show Tool Audit");
        await panel.inside((view) => view.waitForText("Outcome unknown for"));
      },
    },
    {
      label: "All sessions audit",
      beatMs: 1_200,
      action: (driver) =>
        panel.inside(async (view) => {
          await driver.click(await (await browser.$(tab("All sessions"))).getElement());
          await view.waitForText("All sessions");
        }),
    },
    {
      label: "Copy Advice Bundle: preview",
      beatMs: 1_200,
      action: async (driver) => {
        await fromContextMenu(driver, "Copy Advice Bundle");
        await panel.inside(async (view) => {
          await view.waitForText("Export advice bundle");
          await driver.click(await (await browser.$("button=Preview")).getElement());
          await browser.$("[data-testid='advice-preview']").waitForExist({ timeout: 30_000 });
        });
      },
    },
    {
      label: "close the dialog without copying",
      beatMs: 800,
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
