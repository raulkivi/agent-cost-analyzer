// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Step 10.21 (monthly AI Credits allowance gauge), task MA9, plan §7 and §8:
// a folder opened in Restricted Mode whose own settings.json sets a huge
// allowance neither shows nor changes the gauge: the setting is application
// scope, so only the user's value counts. wdio.conf.mts runs this spec in the
// trust launch, before mcp-trust.e2e.ts trusts the folder (check 2.5).
import { readFileSync } from "node:fs";
import path from "node:path";
import { browser, expect } from "@wdio/globals";
import { INTERNAL_COMMAND_IDS } from "../../../src/diagnostics/test-hooks.js";
import { ALLOWANCE_SETTING, gaugeDom, resetDayFor, RESET_DAY_SETTING } from "../support/monthly-allowance-gauge.js";
import { parseUiFixture, TRUST_FIXTURE_ENV } from "../support/ui-fixture-env.mts";
import { wdioVscodeHost as host } from "../support/vscode-host.js";

interface TreeNode {
  kind: string;
  id?: string;
  label?: string;
}

function sessionsTree(): Promise<TreeNode[]> {
  return host.hook<TreeNode[]>(INTERNAL_COMMAND_IDS.sessionsTree);
}

async function allowanceRow(): Promise<TreeNode | undefined> {
  return (await sessionsTree()).find((node) => node.kind === "message" && node.id === "monthly-allowance");
}

const fixture = parseUiFixture(process.env[TRUST_FIXTURE_ENV], TRUST_FIXTURE_ENV);
// What the folder's .vscode/settings.json sets (wdio.conf.mts).
const WORKSPACE_ALLOWANCE = 999_999;
const USER_ALLOWANCE = 123.45;

suite("Monthly allowance in a Restricted workspace (step 10.21, MA9)", () => {
  suiteSetup(async () => {
    await host.waitForExtension({ userDataDir: fixture.userDataDir });
    await host.setSetting(RESET_DAY_SETTING, resetDayFor(new Date()));
  });

  suiteTeardown(async () => {
    await host.setSetting(ALLOWANCE_SETTING, undefined);
    await host.setSetting(RESET_DAY_SETTING, undefined);
  });

  test("the folder is untrusted, and its huge allowance neither shows a gauge nor changes the user's", async () => {
    expect(await browser.executeWorkbench((vscode) => vscode.workspace.isTrusted)).toBe(false);
    // The folder's own file does carry the huge value.
    const folder = await browser.executeWorkbench((vscode) => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
    expect(JSON.parse(readFileSync(path.join(folder!, ".vscode", "settings.json"), "utf8"))[ALLOWANCE_SETTING]).toBe(WORKSPACE_ALLOWANCE);

    // No user value: no gauge, however large the folder's value. (Copilot Chat is not enabled in
    // this launch, so the status bar says "setup needed"; the Sessions row is the gauge's other face.)
    // Wait for the sessions to be read first: before that the row is absent anyway, which proves nothing.
    await browser.waitUntil(async () => (await sessionsTree()).some((node) => node.kind === "group"), {
      timeout: 30_000,
      timeoutMsg: "the Sessions tree never listed the fixture's sessions",
    });
    expect(await gaugeDom()).toBeUndefined();
    expect(await allowanceRow()).toBeUndefined();

    // The user's value: the gauge reads it, not the folder's.
    await host.setSetting(ALLOWANCE_SETTING, USER_ALLOWANCE);
    let row: TreeNode | undefined;
    await browser.waitUntil(async () => (row = await allowanceRow()) !== undefined, { timeout: 30_000, timeoutMsg: "the gauge did not show for the user's allowance" });
    expect(row?.label).toContain(`of ${USER_ALLOWANCE} AI Credits`);
    expect(row?.label).not.toContain("999");
    expect(await host.setting(ALLOWANCE_SETTING)).toBe(USER_ALLOWANCE);
  });

  test("the Settings editor's Workspace tab does not offer the allowance setting", async () => {
    void host.command("workbench.action.openWorkspaceSettings").catch(() => undefined);
    await browser.waitUntil(async () => (await browser.execute(() => document.querySelector(".settings-editor") !== null)) as boolean, { timeout: 30_000 });
    await host.command("workbench.action.openSettings", `@id:${ALLOWANCE_SETTING}`);
    const rows = async (): Promise<string[]> =>
      browser.execute(() => Array.from(document.querySelectorAll<HTMLElement>(".settings-editor .settings-tree-container .monaco-list-row")).map((element) => element.innerText));
    await browser.waitUntil(async () => (await rows()).some((row) => row.includes("Leave empty or 0")), { timeout: 30_000, timeoutMsg: "User tab: the allowance setting is not listed" });
    // The Workspace tab: an application-scoped setting is not shown.
    await browser.execute(() => {
      const tab = Array.from(document.querySelectorAll<HTMLElement>(".settings-editor .settings-tabs-widget .action-label")).find((element) => element.innerText.trim().startsWith("Workspace"));
      tab?.click();
    });
    await browser.waitUntil(async () => !(await rows()).some((row) => row.includes("Leave empty or 0")), { timeout: 30_000, timeoutMsg: "the Workspace tab lists the allowance setting" });
    await host.command("workbench.action.closeAllEditors");
  });
});
