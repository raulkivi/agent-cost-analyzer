// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";
import path from "node:path";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import type { MonthlyAllowanceAnswer } from "@agent-cost-analyzer/domain";
import { axeViolations } from "../support/axe.js";
import { expect, openDashboard, test } from "../support/app-fixture.js";
import { FIXTURE_NOW } from "../support/fixture-clock.js";
import { connectStdioMcp, structured } from "../support/mcp-stdio.js";

// MS8 (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/monthly-allowance-standalone.md §11, 1.0 criterion C9): the monthly
// allowance in the real app, in the light and dark projects. The fixture home
// has Copilot sessions inside the period of FIXTURE_NOW (2026-11-06, UTC;
// fixture-home.mts), whose start days the reset day picks between:
//   reset day 1 or 2  Agent Host (6 of 6 known, 19.76), classic known (5.10)
//                     and classic unknown: "at least 24.86", 7 of 8 sessions
//   reset day 3       the classic two only: "at least 5.10", 1 of 2
//   reset day 4 or 5  the classic unknown session only: unknown

test.use({ allowanceSessions: true });

interface Seed {
  aiCredits: number;
  resetDay: number;
  warnAtPercent: number;
}
const SET: Seed = { aiCredits: 1000, resetDay: 1, warnAtPercent: 80 };
const UNKNOWN: Seed = { aiCredits: 1000, resetDay: 5, warnAtPercent: 80 };

const gauge = (page: Page): Locator => page.locator(".allowance-gauge");
const detailsDialog = (page: Page): Locator => page.getByRole("dialog", { name: "Monthly allowance" });

async function getAnswer(request: APIRequestContext, baseURL: string): Promise<MonthlyAllowanceAnswer> {
  const response = await request.get(`${baseURL}/api/monthly-allowance`);
  expect(response.status()).toBe(200);
  return (await response.json()) as MonthlyAllowanceAnswer;
}

async function put(request: APIRequestContext, baseURL: string, settings: Seed): Promise<void> {
  const response = await request.put(`${baseURL}/api/config/monthly-allowance`, { data: settings });
  expect(response.status()).toBe(200);
}

// Details, then Change allowance: the settings dialog of a set allowance.
async function openSettingsFromDetails(page: Page): Promise<Locator> {
  await gauge(page).click();
  await detailsDialog(page).getByRole("button", { name: "Change allowance" }).click();
  const dialog = detailsDialog(page);
  await expect(dialog.getByLabel("Monthly allowance (AI Credits)")).toBeFocused();
  return dialog;
}

test.describe("not set", () => {
  test("Not set: the Set monthly allowance button and no figure", async ({ page, app, request }) => {
    await openDashboard(page, app.baseURL);
    await expect(page.getByRole("button", { name: "Set monthly allowance" })).toBeVisible();
    await expect(gauge(page)).toHaveCount(1);
    await expect(gauge(page)).not.toContainText("AI Credits");
    expect((await getAnswer(request, app.baseURL)).state).toBe("not-set");
  });

  test("Set through the dialog: the gauge appears and is still there after a reload", async ({ page, app }) => {
    await openDashboard(page, app.baseURL);
    await page.getByRole("button", { name: "Set monthly allowance" }).click();
    const dialog = detailsDialog(page);
    await expect(dialog.getByLabel("Monthly allowance (AI Credits)")).toBeFocused();
    await dialog.getByLabel("Monthly allowance (AI Credits)").fill("1000");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(gauge(page)).toContainText("at least 24.86 of 1,000 AI Credits");
    await expect(page.getByRole("status").filter({ hasText: "Monthly allowance saved." })).toHaveCount(1);

    // The file was written.
    const file = JSON.parse(readFileSync(path.join(app.appSettingsDir, "settings.json"), "utf8")) as { monthlyAllowance: Seed };
    expect(file.monthlyAllowance).toEqual(SET);

    await openDashboard(page, app.baseURL);
    await expect(gauge(page)).toContainText("at least 24.86 of 1,000 AI Credits");
  });
});

test.describe("a set allowance", () => {
  test.use({ allowance: SET });

  test("Invalid values (0, -1, reset day 29, warn 101): the server's message beside the field, and a GET is unchanged", async ({ page, app, request }) => {
    const before = await getAnswer(request, app.baseURL);
    await openDashboard(page, app.baseURL);
    const dialog = await openSettingsFromDetails(page);
    const credits = dialog.getByLabel("Monthly allowance (AI Credits)");
    const resetDay = dialog.getByLabel("Reset day (1 to 28)");
    const warn = dialog.getByLabel("Warn at (percent of allowance)");

    const cases: { field: Locator; values: [string, string, string]; message: RegExp }[] = [
      { field: credits, values: ["0", "1", "80"], message: /Too small: expected number to be >0/ },
      { field: credits, values: ["-1", "1", "80"], message: /Too small: expected number to be >0/ },
      { field: resetDay, values: ["1000", "29", "80"], message: /Too big: expected number to be <=28/ },
      { field: warn, values: ["1000", "1", "101"], message: /Too big: expected number to be <=100/ },
    ];
    for (const { field, values, message } of cases) {
      await credits.fill(values[0]);
      await resetDay.fill(values[1]);
      await warn.fill(values[2]);
      await dialog.getByRole("button", { name: "Save" }).click();
      await expect(field).toHaveAttribute("aria-invalid", "true");
      await expect(field).toBeFocused();
      await expect(dialog.getByRole("alert").filter({ hasText: message })).toBeVisible();
      await expect(dialog.getByRole("alert").filter({ hasText: "Nothing was saved. The gauge is unchanged." })).toBeVisible();
      expect(await getAnswer(request, app.baseURL)).toEqual(before);
    }
    expect(await axeViolations(page)).toEqual([]);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(gauge(page)).toContainText("at least 24.86 of 1,000 AI Credits");
  });

  test("Remove allowance: back to not set, the reset day and threshold kept", async ({ page, app, request }) => {
    await put(request, app.baseURL, { aiCredits: 1000, resetDay: 3, warnAtPercent: 70 });
    await openDashboard(page, app.baseURL);
    await expect(gauge(page)).toContainText("at least 5.10 of 1,000 AI Credits");
    const dialog = await openSettingsFromDetails(page);
    // The hint shows on hover and focus; it must not move the button from under the pointer.
    const remove = dialog.getByRole("button", { name: "Remove allowance" });
    await remove.click();
    await expect(page.getByRole("button", { name: "Set monthly allowance" })).toBeVisible();
    await expect(gauge(page)).not.toContainText("AI Credits");
    await expect(page.getByRole("status").filter({ hasText: "Monthly allowance removed." })).toHaveCount(1);
    const answer = await getAnswer(request, app.baseURL);
    expect(answer.state).toBe("not-set");
    expect(answer.settings).toEqual({ aiCredits: null, resetDay: 3, warnAtPercent: 70 });
  });

  test("Near and over: the words 'near limit' and 'over' are in the button text", async ({ page, app, request }) => {
    // Billed 24.86 so far: 99 percent of 25 is near the 80 percent threshold, 20 is passed.
    await put(request, app.baseURL, { ...SET, aiCredits: 25 });
    await openDashboard(page, app.baseURL);
    await expect(gauge(page)).toContainText("at least 24.86 of 25 AI Credits · near limit");
    await expect(gauge(page)).toHaveAccessibleName(/Near limit\./);

    await put(request, app.baseURL, { ...SET, aiCredits: 20 });
    await openDashboard(page, app.baseURL);
    await expect(gauge(page)).toContainText("at least 24.86 of 20 AI Credits · over");
    await expect(gauge(page)).toHaveAccessibleName(/Over the allowance\./);
  });

  test("Partial: 'at least' and never '0 of' with some sessions without cost data", async ({ page, app, request }) => {
    await openDashboard(page, app.baseURL);
    await expect(gauge(page)).toContainText("at least 24.86 of 1,000 AI Credits");
    await expect(gauge(page)).not.toContainText(/(^|\s)0 of/);

    // Reset day 3: the known classic session (5.10) and the unknown one.
    await put(request, app.baseURL, { ...SET, resetDay: 3 });
    await openDashboard(page, app.baseURL);
    await expect(gauge(page)).toContainText("at least 5.10 of 1,000 AI Credits");
    await expect(gauge(page)).not.toContainText(/(^|\s)0 of/);
  });

  test("Unknown: no session in the period has cost data, so 'unknown' and never '0 of'", async ({ page, app, request }) => {
    await put(request, app.baseURL, UNKNOWN);
    await openDashboard(page, app.baseURL);
    await expect(gauge(page)).toContainText("AI Credits this month: unknown");
    await expect(gauge(page)).not.toContainText(/(^|\s)0 of|0\.00/);
    const answer = await getAnswer(request, app.baseURL);
    expect(answer.state).toBe("unknown");
    expect(answer.figures).toEqual({ coverage: { known: 0, total: 1 }, countedSinceKey: "2026-11-05" });

    await gauge(page).click();
    const dialog = detailsDialog(page);
    await expect(dialog).toContainText("Unknown is not 0.");
    await expect(dialog.getByRole("row", { name: /Copilot Chat/ })).toContainText("0 of 1");
    await expect(dialog.getByRole("row", { name: /Copilot Chat/ })).toContainText("unknown");
    expect(await axeViolations(page)).toEqual([]);
  });

  test("Switching the active provider leaves the gauge's figure unchanged", async ({ page, app }) => {
    await openDashboard(page, app.baseURL);
    const figure = "at least 24.86 of 1,000 AI Credits";
    await expect(gauge(page)).toContainText(figure);
    const source = page.getByRole("combobox", { name: "Log provider" });
    for (const label of ["Claude Code CLI", "pi coding agent"]) {
      await source.selectOption({ label });
      await expect(source.locator("option:checked")).toHaveText(label);
      await expect(gauge(page)).toContainText(figure);
    }
  });

  test("Learn mode has no gauge", async ({ page, app }) => {
    await page.goto(app.baseURL);
    await expect(page.getByRole("list", { name: "Scenarios" })).toBeVisible();
    await expect(gauge(page)).toHaveCount(0);
    await openDashboard(page, app.baseURL);
    await expect(gauge(page)).toBeVisible();
    await page.locator("label.seg-opt", { hasText: "Learn" }).click();
    await expect(page.getByRole("list", { name: "Scenarios" })).toBeVisible();
    await expect(gauge(page)).toHaveCount(0);
  });

  test("Details: period with zone, coverage, by-harness split and VS Code variant; keyboard open and close with focus back; axe on the header and both dialogs", async ({ page, app }) => {
    await openDashboard(page, app.baseURL);
    await expect(gauge(page)).toContainText("at least 24.86 of 1,000 AI Credits");
    expect(await axeViolations(page)).toEqual([]);

    // Keyboard: focus the gauge, Enter opens, focus lands on Close, Escape closes and focus returns.
    await gauge(page).focus();
    await page.keyboard.press("Enter");
    const dialog = detailsDialog(page);
    await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
    await expect(dialog).toContainText("2026-11-01 to 2026-11-30 (UTC)");
    await expect(dialog).toContainText("7 of 8 sessions this month have cost data");
    await expect(dialog).toContainText("VS Code");
    const split = dialog.getByRole("table");
    await expect(split.getByRole("row", { name: /Copilot Chat/ })).toContainText("1 of 2");
    await expect(split.getByRole("row", { name: /Copilot Chat/ })).toContainText("at least 5.10");
    await expect(split.getByRole("row", { name: /Agent Host and Copilot CLI/ })).toContainText("6 of 6");
    await expect(split.getByRole("row", { name: /Agent Host and Copilot CLI/ })).toContainText("19.76");
    expect(await axeViolations(page)).toEqual([]);

    // Tab stays inside the dialog.
    for (let step = 0; step < 6; step++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(gauge(page)).toBeFocused();

    // Close with the button; focus returns too.
    await page.keyboard.press("Enter");
    await dialog.getByRole("button", { name: "Close" }).press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect(gauge(page)).toBeFocused();

    // Change allowance: the settings dialog, its axe check, Escape, focus back on the gauge.
    await page.keyboard.press("Enter");
    await dialog.getByRole("button", { name: "Change allowance" }).press("Enter");
    await expect(dialog.getByLabel("Monthly allowance (AI Credits)")).toBeFocused();
    expect(await axeViolations(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(gauge(page)).toBeFocused();
  });

  test("The Source select is capped at 150 px and the status text gives way before the gauge at 1440 px", async ({ page, app }) => {
    await openDashboard(page, app.baseURL);
    await expect(gauge(page)).toContainText("at least 24.86 of 1,000 AI Credits");
    const select = await page.getByRole("combobox", { name: "Log provider" }).boundingBox();
    expect(select!.width).toBeLessThanOrEqual(150.5);
    const header = page.locator("header.nav");
    expect(await header.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    // The gauge keeps its whole text; the server status line is what truncates.
    expect(await gauge(page).locator(".allowance-gauge-text").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    const status = page.locator(".app-status--inline");
    expect(await status.evaluate((element) => getComputedStyle(element).textOverflow)).toBe("ellipsis");
  });

  test("320 px: no horizontal scroll and the figure is visible", async ({ page, app }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await openDashboard(page, app.baseURL);
    await expect(gauge(page)).toContainText("at least 24.86 of 1,000 AI Credits");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await expect(gauge(page)).toBeInViewport({ ratio: 1 });
    const box = await gauge(page).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  });

  test("MCP get_monthly_allowance equals the header's figures and GET /api/monthly-allowance", async ({ page, app, request }) => {
    await openDashboard(page, app.baseURL);
    await expect(gauge(page)).toContainText("at least 24.86 of 1,000 AI Credits");
    const api = await getAnswer(request, app.baseURL);

    // The stdio server reads the same home; give it the fixture's clock and zone.
    const saved = { now: process.env.AGENT_COST_ANALYZER_NOW, zone: process.env.TZ };
    process.env.AGENT_COST_ANALYZER_NOW = FIXTURE_NOW;
    process.env.TZ = "UTC";
    const client = await connectStdioMcp(app.home);
    let mcp: MonthlyAllowanceAnswer;
    try {
      mcp = structured(await client.callTool({ name: "get_monthly_allowance", arguments: {} }));
    } finally {
      await client.close();
      for (const [name, value] of [["AGENT_COST_ANALYZER_NOW", saved.now], ["TZ", saved.zone]] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }

    expect(mcp).toEqual(api);
    const figures = mcp.figures as { used: number; atLeast: boolean };
    expect(figures.atLeast).toBe(true);
    await expect(gauge(page)).toContainText(`at least ${figures.used.toFixed(2)} of 1,000 AI Credits`);
  });
});
