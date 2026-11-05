// Manual check 1.12, second half: the launch after the analyzer was uninstalled
// (uninstall-installed.e2e.ts) shows none of it. The settings file is not
// checked here: wdio-vscode-service rewrites it at every launch.
import { browser, expect } from "@wdio/globals";
import { VIEW_CONTAINER_TITLE } from "../support/sidebar-views.js";
import { wdioVscodeHost as host } from "../support/vscode-host.js";

suite("Uninstall, part 2: after a relaunch (check 1.12)", () => {
  suiteSetup(async () => {
    await host.waitForWorkbench();
  });

  test("1.12 no analyzer extension, commands, Activity Bar icon, status bar item or editor tab remain", async () => {
    expect(await host.extensionIds("raulkivi.ai-credits-analyzer")).toEqual([]);
    expect(await host.commandsWithPrefix("aiCreditsAnalyzer")).toEqual([]);
    const workbench = await browser.getWorkbench();
    expect(await workbench.getActivityBar().getViewControl(VIEW_CONTAINER_TITLE)).toBeUndefined();
    expect((await workbench.getStatusBar().getItems()).filter((item) => item.includes("AI Credits"))).toEqual([]);
    expect(await workbench.getEditorView().getOpenEditorTitles()).toEqual([]);
  });
});
