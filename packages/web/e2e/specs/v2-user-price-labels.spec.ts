// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { axeViolations } from "../support/axe.js";
import { chooseOption, expect, openDashboard, selectListValue, test } from "../support/app-fixture.js";

// 1.0 V2 (threat-model §5.10): a figure priced from the user's own price
// version says "your prices", with the version id in its accessible name.
// The fixture home's Customer portal project gets a contract version of
// Claude Sonnet 5.5 on the Anthropic API (what a user adds under
// channels.priceVersions in projects.json); its Claude Code turns are priced
// with it. Billing service keeps the bundled list price, so its figures never
// carry the label. The suite runs light and dark (playwright.config.ts).
const VERSION_ID = "acme-contract:claude-sonnet-5.5:2026-10-01";
const NAME = `Priced with your own price version: ${VERSION_ID}`;

function addUserPriceVersion(appSettingsDir: string): void {
  mkdirSync(appSettingsDir, { recursive: true });
  writeFileSync(
    path.join(appSettingsDir, "projects.json"),
    `${JSON.stringify(
      {
        version: 1,
        projects: [
          { id: "portal", name: "Customer portal", members: [{ repository: "github.com/acme/portal-web" }, { repository: "github.com/acme/portal-api" }] },
          { id: "billing", name: "Billing service", members: [{ repository: "github.com/acme/billing" }] },
        ],
        channels: {
          priceVersions: [
            {
              id: VERSION_ID,
              channel: "anthropic-api",
              modelId: "claude-sonnet-5.5",
              currency: "USD",
              effectiveFrom: "2026-10-01",
              kind: "contract",
              scope: { projectId: "portal" },
              tiers: [{ inputUsdPerM: 1, cachedInputUsdPerM: 0.1, cacheWriteUsdPerM: 1.25, outputUsdPerM: 5 }],
            },
          ],
        },
      },
      null,
      2,
    )}\n`,
  );
}

test("V2: figures priced from a user price version say 'your prices'; billed, reported and bundled-priced ones do not", async ({ page, app }) => {
  addUserPriceVersion(app.appSettingsDir);
  await openDashboard(page, app.baseURL);

  // Overview: the Cost tile of the project whose turns the contract prices.
  await selectListValue(page, "Project", /Customer portal/);
  const cost = page.getByRole("group", { name: "Cost", exact: true });
  await expect(cost.getByRole("note", { name: NAME })).toHaveText("your prices");
  // Billed and reported totals are never labelled, whatever priced the other turns.
  const basis = page.getByRole("group", { name: "Cost basis for totals" });
  await basis.locator("label.seg-opt", { hasText: "Billed" }).click();
  await expect(cost.getByRole("note")).toHaveCount(0);
  await basis.locator("label.seg-opt", { hasText: "Reported" }).click();
  await expect(cost.getByRole("note")).toHaveCount(0);
  await basis.locator("label.seg-opt", { hasText: "Preferred" }).click();
  await expect(cost.getByRole("note", { name: NAME })).toBeVisible();

  // Cost over time.
  await chooseOption(page, "Dashboard view", "Cost over time");
  await chooseOption(page, "Date range", "Last 90 days");
  const total = page.getByRole("group", { name: "Total cost" });
  await expect(total.getByRole("note", { name: NAME })).toHaveText("your prices");
  await expect(total.getByRole("note", { name: NAME })).toHaveAttribute("title", new RegExp(VERSION_ID));
  expect(await axeViolations(page)).toEqual([]);

  // Compare: only the project priced with the user version is labelled.
  await selectListValue(page, "Project", /Billing service/, true);
  await chooseOption(page, "Dashboard view", "Compare");
  const table = page.getByRole("table", { name: "Compare 2 projects" });
  await expect(table).toBeVisible();
  await expect(table.getByRole("row", { name: /Customer portal/ }).getByRole("note", { name: NAME })).toBeVisible();
  await expect(table.getByRole("row", { name: /Billing service/ }).getByRole("note")).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);
});

test("V2: with only bundled prices nothing is labelled", async ({ page, app }) => {
  await openDashboard(page, app.baseURL);
  await selectListValue(page, "Project", /Customer portal/);
  await expect(page.getByRole("group", { name: "Cost", exact: true })).toBeVisible();
  await expect(page.getByRole("note", { name: /your own price/ })).toHaveCount(0);
});
