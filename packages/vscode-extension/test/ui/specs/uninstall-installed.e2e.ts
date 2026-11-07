// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Manual check 1.12, first half (docs/plans/vscode-extension-manual-checks.md):
// the analyzer installed from its VSIX into a throwaway profile (wdio.conf.mts
// "uninstall" launch; the development extension is an empty stand-in), as a
// user has it, then uninstalled through VS Code's own command.
// uninstall-after.e2e.ts, the next launch on this profile, checks what is left.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { browser, expect } from "@wdio/globals";
import { VIEW_CONTAINER_TITLE } from "../support/sidebar-views.js";
import { parseFirstRunFixture, UNINSTALL_FIXTURE_ENV } from "../support/ui-fixture-env.mts";
import { wdioVscodeHost as host } from "../support/vscode-host.js";

const fixture = parseFirstRunFixture(process.env[UNINSTALL_FIXTURE_ENV], UNINSTALL_FIXTURE_ENV);
const EXTENSION_ID = "raulkivi.ai-credits-analyzer";
const extensionsDir = path.join(fixture.storagePath, "extensions");

// VS Code marks an uninstalled extension's folder in .obsolete (or deletes it)
// and drops it from the extensions manifest; both must be on disk before the
// window is closed, or the next launch still loads it.
function uninstalled(): boolean {
  const manifest = path.join(extensionsDir, "extensions.json");
  if (existsSync(manifest) && readFileSync(manifest, "utf-8").toLowerCase().includes(EXTENSION_ID)) return false;
  const folders = readdirSync(extensionsDir).filter((name) => name.toLowerCase().startsWith(EXTENSION_ID));
  const obsoleteFile = path.join(extensionsDir, ".obsolete");
  const obsolete = existsSync(obsoleteFile) ? readFileSync(obsoleteFile, "utf-8").toLowerCase() : "";
  return folders.every((name) => obsolete.includes(name.toLowerCase()));
}

suite("Uninstall, part 1: installed from the VSIX (check 1.12)", () => {
  suiteSetup(async () => {
    await host.waitForWorkbench();
  });

  test("1.12 the installed copy runs, with its commands and Activity Bar icon", async () => {
    await browser.waitUntil(async () => (await host.extensionIds(EXTENSION_ID)).length === 1, { timeout: 60_000, timeoutMsg: "the installed analyzer did not load" });
    expect(uninstalled()).toBe(false);
    // Installed, not under development: no Test-mode hooks, as for a user.
    expect(await host.commandsWithPrefix("aiCreditsAnalyzer.open")).toContain("aiCreditsAnalyzer.open");
    expect(await host.commandsWithPrefix("aiCreditsAnalyzer.internal")).toEqual([]);
    expect(await (await browser.getWorkbench()).getActivityBar().getViewControl(VIEW_CONTAINER_TITLE)).toBeDefined();
  });

  test("1.12 uninstalling marks it removed, and leaves the user's settings file exactly as it was", async () => {
    const settingsFile = path.join(fixture.userDataDir, "User", "settings.json");
    // The profile starts with a Copilot Chat setting a user set by hand after a
    // Fix button opened it (a Fix only opens settings; the analyzer never writes them).
    const before = readFileSync(settingsFile, "utf-8");
    expect(JSON.parse(before)).toMatchObject(fixture.userSettings);

    await host.command("workbench.extensions.uninstallExtension", EXTENSION_ID);
    await browser.waitUntil(uninstalled, { timeout: 30_000, timeoutMsg: "VS Code did not mark the analyzer uninstalled" });

    expect(readFileSync(settingsFile, "utf-8")).toBe(before);
  });
});
