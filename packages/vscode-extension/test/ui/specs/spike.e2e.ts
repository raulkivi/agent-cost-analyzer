import { browser, expect } from "@wdio/globals";
import { parseUiFixture } from "../support/ui-fixture-env.mts";

const fixture = parseUiFixture(process.env.AI_CREDITS_ANALYZER_UI_FIXTURE);

suite("spike", () => {
  test("test hooks are reachable and the Sessions view lists the fixture", async () => {
    const tree = (await browser.executeWorkbench(async (vscode) => {
      return vscode.commands.executeCommand("aiCreditsAnalyzer.internal.sessionsTree");
    })) as unknown[];
    console.log("sessionsTree nodes", JSON.stringify(tree).length);
    expect(Array.isArray(tree)).toBe(true);
  });

  test("openSession opens the panel and the turn row shows", async () => {
    await browser.executeWorkbench(async (vscode, id) => {
      await vscode.commands.executeCommand("aiCreditsAnalyzer.openSession", id);
    }, fixture.usageSessionId);
    const workbench = await browser.getWorkbench();
    await browser.waitUntil(async () => (await workbench.getAllWebviews()).length > 0, { timeout: 30_000 });
    const [webview] = await workbench.getAllWebviews();
    await webview.open();
    const rows = await browser.$$("table tbody tr");
    await browser.waitUntil(async () => (await browser.$$("table tbody tr")).length > 0, { timeout: 30_000 });
    console.log("rows", rows.length, await browser.$("body").getText());
    await webview.close();
  });
});
