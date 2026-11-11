// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Records the colours VS Code resolves for its High Contrast themes. Not a
// test: it asserts only that the generated theme is the one asked for, then
// writes it for packages/mcp-apps/test/theme/host-sets.ts to read.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { browser, expect } from "@wdio/globals";
import { wdioVscodeHost as host } from "../support/vscode-host.js";

const OUT = path.resolve(import.meta.dirname, "../../../../../docs/plans/mcp-apps-a24-results");
const GENERATE_THEME = "workbench.action.generateColorTheme";

const THEMES = [
  { name: "Default High Contrast", type: "hcDark", file: "vscode-hc-dark-theme.jsonc" },
  { name: "Default High Contrast Light", type: "hcLight", file: "vscode-hc-light-theme.jsonc" },
];

suite("record VS Code host themes (A24 1.7a)", () => {
  suiteSetup(async () => {
    await host.waitForWorkbench();
  });

  for (const theme of THEMES) {
    test(`${theme.name} -> ${theme.file}`, async () => {
      await host.setSetting("workbench.colorTheme", theme.name);
      let text = "";
      // The theme applies asynchronously: generate until the document names the wanted type.
      await browser.waitUntil(
        async () => {
          await host.command(GENERATE_THEME);
          text = (await host.activeEditor()).text ?? "";
          return text.includes(`"type": "${theme.type}"`);
        },
        { timeout: 30_000, interval: 1_000, timeoutMsg: `the generated theme never had type ${theme.type}` },
      );
      expect(text).toContain('"colors"');
      mkdirSync(OUT, { recursive: true });
      writeFileSync(path.join(OUT, theme.file), text.endsWith("\n") ? text : `${text}\n`);
      await host.command("workbench.action.revertAndCloseActiveEditor");
    });
  }
});
