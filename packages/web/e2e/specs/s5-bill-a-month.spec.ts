import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { axeViolations } from "../support/axe.js";
import { chooseOption, expect, openDashboard, selectListValue, test } from "../support/app-fixture.js";

// Scenario S5, "Bill a month" (plan §12.4.2, board 4; step 15.11): October
// draft → Issue statement → confirm → export CSV and Markdown → a price-book
// update → reload. Passes when the frozen statement shows the same figures
// as before, "Differs from issued" shows the exact diff, the exports hold
// no message text, and the unknown-cost line is listed, not summed.
//
// The portal's priced turns are Claude Code's, API-equivalent, so the
// project first includes subscription use (D4) in the Projects editor. The
// price-book update is a contract price for the project in projects.json
// (the user's part of the price book), ten times the list price.

test("S5: bill a month, freeze it, export it, and see the diff after a price change", async ({ page, app }) => {
  await openDashboard(page, app.baseURL);
  await chooseOption(page, "Dashboard view", "Billing");
  await page.getByRole("button", { name: "Edit projects" }).click();
  await page.getByRole("region", { name: "Customer portal" }).getByRole("checkbox", { name: /Include subscription use/ }).check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/^Saved\./)).toBeVisible();
  await page.getByRole("button", { name: /Back to the Dashboard/ }).click();

  await selectListValue(page, "Project", /Customer portal/);
  await chooseOption(page, "Dashboard view", "Billing");
  await expect(page.getByRole("combobox", { name: "Period" })).toHaveValue("2026-10");
  const card = page.getByRole("region", { name: /^Customer portal · 2026-10-01 to 2026-10-31/ });
  await expect(card).toBeVisible();
  const totals = card.getByRole("table", { name: "Totals" });
  const before = await totals.textContent();
  expect(await axeViolations(page)).toEqual([]);

  await page.getByRole("button", { name: "Issue statement" }).click();
  const dialog = page.getByRole("dialog", { name: "Issue the October 2026 statement?" });
  expect(await axeViolations(page)).toEqual([]);
  await dialog.getByRole("button", { name: "Issue statement" }).click();
  await expect(card.getByText("Frozen")).toBeVisible();
  await expect(totals).toHaveText(before!);

  // Exports: CSV and Markdown, with no message text.
  await card.getByRole("button", { name: "Export…" }).click();
  const exportDialog = page.getByRole("dialog", { name: /^Export/ });
  const preview = exportDialog.getByLabel("Preview");
  await expect(preview).toHaveValue(/^kind,basis,currency/);
  expect(await preview.inputValue()).not.toMatch(/Placeholder (prompt|answer)/);
  await exportDialog.getByRole("radio", { name: "Markdown" }).check();
  await expect(preview).toHaveValue(/# Statement: Customer portal, October 2026/);
  expect(await preview.inputValue()).not.toMatch(/Placeholder (prompt|answer)/);
  expect(await axeViolations(page)).toEqual([]);
  await page.keyboard.press("Escape");

  // A price-book update: the project's own contract price, ten times the list.
  const file = path.join(app.appSettingsDir, "projects.json");
  const projects = JSON.parse(readFileSync(file, "utf-8"));
  projects.channels = {
    priceVersions: [
      {
        id: "contract:portal:sonnet",
        channel: "anthropic-api",
        modelId: "claude-sonnet-5.5",
        currency: "USD",
        effectiveFrom: "2026-10-01",
        tiers: [{ inputUsdPerM: 30, cachedInputUsdPerM: 3, cacheWriteUsdPerM: 37.5, extendedCacheWriteUsdPerM: 60, outputUsdPerM: 150 }],
        kind: "contract",
        scope: { projectId: "portal" },
      },
    ],
  };
  writeFileSync(file, JSON.stringify(projects, null, 2));
  await page.reload();
  await openDashboard(page, app.baseURL);
  await selectListValue(page, "Project", /Customer portal/);
  await chooseOption(page, "Dashboard view", "Billing");
  await expect(card.getByText("Frozen")).toBeVisible();
  await expect(totals).toHaveText(before!);
  await expect(page.getByText("Differs from issued")).toBeVisible();
  await page.getByRole("button", { name: "View diff" }).click();
  const diff = page.getByRole("table", { name: "Differences from the issued statement" });
  await expect(diff.getByRole("row", { name: /^Total, USD/ })).toContainText("+");
  await expect(diff).toContainText("anthropic-api");
  await expect(page.getByText("The price book changed.", { exact: false })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  // The unknown-cost line is listed, not summed: September's only portal turn
  // is from before the price book's first price.
  await page.getByRole("combobox", { name: "Period" }).selectOption("2026-09");
  const september = page.getByRole("region", { name: /^Customer portal · 2026-09-01 to 2026-09-30/ });
  await expect(september.getByText(/1 turn, cost unknown:/)).toBeVisible();
  await expect(september.getByText("Not counted as 0.", { exact: false })).toBeVisible();
  await expect(september.getByText(/Coverage: 0 of 1 turns have a known cost/)).toBeVisible();
  await expect(september.getByRole("table", { name: "Totals" }).locator("tbody tr")).toHaveCount(0);
});
