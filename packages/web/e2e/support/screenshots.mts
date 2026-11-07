// Phase 15 step 15.9: the docs' screenshots of the Dashboard's cost tabs in
// the standalone app, over the usage-scenario fixture home (sample data
// only) at the fixed clock, at a desktop width and at 360 px, 2x.
//   npm run build --workspace=packages/web
//   npx tsx packages/web/e2e/support/screenshots.mts [outDir]   (default docs/images)
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { chromium, type Page } from "playwright";
import { FIXTURE_NOW } from "./fixture-clock.ts";

const webDir = path.resolve(import.meta.dirname, "../..");
const outDir = path.resolve(process.argv[2] ?? path.join(webDir, "../../docs/images"));
mkdirSync(outDir, { recursive: true });

const home = mkdtempSync(path.join(os.tmpdir(), "aca-e2e-"));
const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, AGENT_COST_ANALYZER_NOW: FIXTURE_NOW };
for (const name of ["XDG_CONFIG_HOME", "APPDATA", "COPILOT_HOME"]) delete env[name];
const child = spawn(path.resolve(webDir, "../../node_modules/.bin/tsx"), ["e2e/support/serve.mts"], { cwd: webDir, env, stdio: ["ignore", "pipe", "inherit"] });
const port = await new Promise<number>((resolve) => {
  createInterface({ input: child.stdout! }).on("line", (line) => {
    if (line.startsWith("{")) resolve((JSON.parse(line) as { port: number }).port);
  });
});

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const browser = await chromium.launch(executablePath ? { executablePath } : {});

async function radio(page: Page, group: string, option: string) {
  await page.getByRole("radiogroup", { name: group }).locator("label.seg-opt", { hasText: option }).click();
}

async function dashboard(width: number, height: number): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  await page.clock.setFixedTime(new Date(FIXTURE_NOW));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.getByText("Analyze", { exact: true }).click();
  const view = page.getByRole("combobox", { name: /^view$/i });
  if (await view.isVisible().catch(() => false)) await view.selectOption({ label: "Dashboard" });
  else await page.locator("label.seg-opt", { hasText: "Dashboard" }).click();
  await page.getByRole("group", { name: "AI Credits", exact: true }).waitFor();
  return page;
}

async function openView(page: Page, view: "Cost over time" | "Compare" | "Project" | "Billing") {
  const select = page.getByRole("combobox", { name: "Dashboard view" });
  if (await select.isVisible().catch(() => false)) await select.selectOption({ label: view });
  else await radio(page, "Dashboard view", view);
}

// §11.6: nothing may push the page wider than the viewport.
async function overflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth <= width) return [];
    return [...document.querySelectorAll("body *")]
      .filter((element) => element.getBoundingClientRect().right > width + 1)
      .slice(0, 12)
      .map((element) => `${element.tagName.toLowerCase()}.${(element.getAttribute("class") ?? "").split(" ").join(".")} right=${Math.round(element.getBoundingClientRect().right)}`);
  });
}

async function shoot(page: Page, name: string) {
  await page.waitForTimeout(300);
  const wide = await overflow(page);
  if (wide.length > 0) {
    process.exitCode = 1;
    console.error(`${name}: wider than the viewport:\n  ${wide.join("\n  ")}`);
  }
  await page.screenshot({ path: path.join(outDir, name), fullPage: process.env.FULL_PAGE === "1" });
  console.log(path.join(outDir, name));
}

try {
  // Desktop: three lines (both projects and No project) with the price marker's tooltip.
  let page = await dashboard(1440, 1000);
  await openView(page, "Cost over time");
  await page.getByRole("group", { name: "Total cost" }).waitFor();
  await page.getByRole("button", { name: /^Price · / }).first().focus();
  await shoot(page, "guide-dashboard-cost-over-time.png");
  await page.close();

  page = await dashboard(1440, 1000);
  await openView(page, "Compare");
  await page.getByRole("table", { name: /Compare/ }).waitFor();
  await shoot(page, "guide-dashboard-compare.png");
  await page.close();

  // 360 px: the view select, the tabs' content first and the list boxes below;
  // Compare keeps its priority columns, the rest in each row's Details.
  page = await dashboard(360, 800);
  await openView(page, "Cost over time");
  await page.getByRole("group", { name: "Total cost" }).waitFor();
  await page.evaluate(() => document.querySelector(".cost-kpis")?.scrollIntoView({ block: "start" }));
  await shoot(page, "guide-dashboard-cost-over-time-360.png");
  await page.close();

  page = await dashboard(360, 800);
  await openView(page, "Compare");
  await page.getByRole("table", { name: /Compare/ }).waitFor();
  await page.evaluate(() => document.querySelector(".cost-compare")?.scrollIntoView({ block: "start" }));
  await shoot(page, "guide-dashboard-compare-360.png");
  await page.close();

  // Step 15.10: the Project tab inside Customer portal, Anthropic chosen.
  page = await dashboard(1440, 1000);
  await openView(page, "Project");
  await page.getByRole("listbox", { name: "Project" }).getByRole("option", { name: /Customer portal/ }).click();
  // The fixture's priced turns are all in October (prices start 2026-10-01).
  await page.getByRole("combobox", { name: "To", exact: true }).selectOption({ label: "Oct 2026" });
  await page.getByRole("img", { name: /^Why cost changed/ }).waitFor();
  await page.evaluate(() => document.querySelector(".cost-tab")?.scrollIntoView({ block: "start" }));
  await shoot(page, "guide-dashboard-project.png");
  await page.close();

  page = await dashboard(360, 800);
  await openView(page, "Project");
  await page.getByRole("listbox", { name: "Project" }).getByRole("option", { name: /Customer portal/ }).click();
  // The fixture's priced turns are all in October (prices start 2026-10-01).
  await page.getByRole("combobox", { name: "To", exact: true }).selectOption({ label: "Oct 2026" });
  await page.getByRole("img", { name: /^Why cost changed/ }).waitFor();
  await page.evaluate(() => document.querySelector(".cost-variance")?.scrollIntoView({ block: "start" }));
  await shoot(page, "guide-dashboard-project-360.png");
  await page.close();

  // Step 15.11: Billing (October, Customer portal) and the Projects editor.
  page = await dashboard(1440, 1000);
  await page.getByRole("listbox", { name: "Project" }).getByRole("option", { name: /Customer portal/ }).click();
  await openView(page, "Billing");
  await page.getByRole("table", { name: "Totals" }).waitFor();
  await page.evaluate(() => document.querySelector(".cost-tab")?.scrollIntoView({ block: "start" }));
  await shoot(page, "guide-dashboard-billing.png");
  await page.getByRole("button", { name: "Edit projects" }).click();
  await page.getByRole("heading", { name: "Projects" }).waitFor();
  await shoot(page, "guide-projects-editor.png");
  await page.close();

  // Step 15.12: the estimate panel (Mobile app: six priced days, so a range).
  page = await dashboard(1440, 1000);
  await page.getByRole("listbox", { name: "Project" }).getByRole("option", { name: /Mobile app/ }).click();
  await openView(page, "Billing");
  await page.getByRole("img", { name: /^Estimate at today's prices/ }).waitFor();
  await page.evaluate(() => document.querySelector(".estimate-panel")?.scrollIntoView({ block: "center" }));
  await shoot(page, "guide-dashboard-estimate.png");
  await page.close();

  page = await dashboard(360, 800);
  await page.getByRole("listbox", { name: "Project" }).getByRole("option", { name: /Customer portal/ }).click();
  await openView(page, "Billing");
  await page.getByRole("table", { name: "Totals" }).waitFor();
  await page.evaluate(() => document.querySelector(".cost-tab")?.scrollIntoView({ block: "start" }));
  await shoot(page, "guide-dashboard-billing-360.png");
  await page.close();
} finally {
  await browser.close();
  child.kill("SIGTERM");
  rmSync(home, { recursive: true, force: true });
}
