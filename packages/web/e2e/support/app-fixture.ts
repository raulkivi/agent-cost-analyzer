import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { test as base, expect, type Page } from "@playwright/test";
import { FIXTURE_NOW } from "./fixture-clock.js";

// Phase 15 step 15.9 (plan §12.4.1): each scenario gets the real server
// (support/serve.mts, through tsx) over a fresh seeded fixture home: a new
// temporary HOME, so the projects file and settings start clean and nothing
// on this machine is read. The server's clock and the page's clock are both
// fixed at FIXTURE_NOW, so "last 90 days" is the same on every run.

const webDir = path.resolve(import.meta.dirname, "../..");
const tsx = path.resolve(webDir, "../../node_modules/.bin/tsx");

// Variables that would point a provider or the app's settings outside the
// fixture home.
const OUTSIDE_HOME = ["XDG_CONFIG_HOME", "APPDATA", "COPILOT_HOME", "CLAUDE_CONFIG_DIR", "PI_CODING_AGENT_DIR"];

async function startServer(home: string): Promise<{ baseURL: string; child: ChildProcess }> {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, AGENT_COST_ANALYZER_NOW: FIXTURE_NOW };
  for (const name of OUTSIDE_HOME) delete env[name];
  const child = spawn(tsx, ["e2e/support/serve.mts"], { cwd: webDir, env, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const port = await new Promise<number>((resolve, reject) => {
    const lines = createInterface({ input: child.stdout! });
    lines.on("line", (line) => {
      const parsed = (() => {
        try {
          return JSON.parse(line) as { port?: number };
        } catch {
          return {};
        }
      })();
      if (parsed.port) resolve(parsed.port);
    });
    child.on("exit", (code) => reject(new Error(`The e2e server exited (${code}) before listening:\n${stderr}`)));
  });
  return { baseURL: `http://127.0.0.1:${port}`, child };
}

export const test = base.extend<{ app: { baseURL: string } }>({
  // Playwright reads a fixture's dependencies from this destructuring; it has none.
  // eslint-disable-next-line no-empty-pattern
  app: async ({}, use) => {
    const home = mkdtempSync(path.join(os.tmpdir(), "aca-e2e-"));
    const { baseURL, child } = await startServer(home);
    try {
      await use({ baseURL });
    } finally {
      child.kill("SIGTERM");
      rmSync(home, { recursive: true, force: true });
    }
  },
  page: async ({ page }, use) => {
    await page.clock.setFixedTime(new Date(FIXTURE_NOW));
    await use(page);
  },
});

export { expect };

// Opens the standalone app's Analyze-mode Dashboard and waits for the data.
export async function openDashboard(page: Page, baseURL: string): Promise<void> {
  await page.goto(baseURL);
  await page.getByText("Analyze", { exact: true }).click();
  const view = page.getByRole("combobox", { name: /^view$/i });
  if (await view.isVisible().catch(() => false)) await view.selectOption({ label: "Dashboard" });
  else await page.locator("label.seg-opt", { hasText: "Dashboard" }).click();
  await expect(page.getByRole("group", { name: "AI Credits", exact: true })).toBeVisible();
}

// The segmented controls' radios are visually hidden; click their labels.
export async function chooseOption(page: Page, group: string, option: string): Promise<void> {
  await page.getByRole("radiogroup", { name: group }).locator("label.seg-opt", { hasText: option }).click();
}

export async function selectListValue(page: Page, listBox: string, value: RegExp, additive = false): Promise<void> {
  await page
    .getByRole("listbox", { name: listBox })
    .getByRole("option", { name: value })
    .click({ modifiers: additive ? ["ControlOrMeta"] : [] });
}
