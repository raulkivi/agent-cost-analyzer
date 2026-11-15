// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
/* global console, process, document */
// Renders each board to screenshots/<Board>-light.png and -dark.png (one per
// color section) and prints the full height of each board for canvas.json.
// Run: node scripts/ms0-allowance-screenshots.mjs
// Needs Playwright's Chromium (installed for the web e2e suite).
import { mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const here = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "plans", "mockups", "monthly-allowance-standalone");
const out = join(here, "screenshots");
mkdirSync(out, { recursive: true });

// The app bundles Commit Mono and Source Serif 4; use them when installed so
// the boards render as the app does, else the system fallbacks apply.
const fontDir = (name) => join(process.cwd(), "node_modules", "@fontsource", name, "files");
const faces = [
  ["Commit Mono", 400, join(fontDir("commit-mono"), "commit-mono-latin-400-normal.woff2")],
  ["Commit Mono", 700, join(fontDir("commit-mono"), "commit-mono-latin-700-normal.woff2")],
  ["Source Serif 4", 400, join(fontDir("source-serif-4"), "source-serif-4-latin-400-normal.woff2")],
]
  .map(([family, weight, file]) => `@font-face{font-family:"${family}";font-weight:${weight};src:url("${pathToFileURL(file).href}") format("woff2")}`)
  .join("");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const boards = readdirSync(here).filter((f) => f.endsWith(".dc.html"));
for (const board of boards) {
  await page.goto(pathToFileURL(join(here, board)).href);
  await page.addStyleTag({ content: faces });
  await page.evaluate(() => document.fonts.ready);
  const name = board.replace(".dc.html", "");
  const sections = page.locator(".sec");
  for (let i = 0; i < (await sections.count()); i += 1) {
    const mode = await sections.nth(i).evaluate((el) => el.dataset.m);
    await sections.nth(i).screenshot({ path: join(out, `${name}-${mode}.png`) });
  }
  const height = await page.evaluate(() => document.querySelector("x-dc > div").getBoundingClientRect().height);
  console.log(`${board} height ${Math.ceil(height)}`);
}
await browser.close();
