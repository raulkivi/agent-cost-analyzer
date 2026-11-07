// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { axeViolations } from "../support/axe.js";
import { chooseOption, expect, openDashboard, selectListValue, test } from "../support/app-fixture.js";

// Scenario S8, "Captures with no folder" (plan §12.4.2, boards 6 and 5; step
// 15.11): mitmproxy only → its sessions are Unattributed, and the editor
// says why → add a capture rule for the fixture's capture folder. Passes
// when those sessions move to the rule's repository and its cost includes
// them.

test("S8: a capture rule moves mitmproxy's Unattributed sessions into a repository", async ({ page, app }) => {
  await openDashboard(page, app.baseURL);
  // The fixture's capture is from 2026-08-01, before the default 30 days.
  await page.locator("label.seg-opt", { hasText: "All time" }).click();
  await selectListValue(page, "Provider", /mitmproxy/i);
  const repositories = page.getByRole("listbox", { name: "Repository" });
  await expect(repositories.getByRole("option", { name: /Unattributed/ })).toBeVisible();

  await chooseOption(page, "Dashboard view", "Billing");
  await page.getByRole("button", { name: "Edit projects" }).click();
  await expect(page.getByText(/(1 session is|sessions are) Unattributed:/)).toBeVisible();
  await page.getByRole("button", { name: "Add a capture rule" }).click();
  await page.getByRole("textbox", { name: "Capture files (glob)" }).fill("~/.config/agent-cost-analyzer/mitmproxy-captures/*.har");
  await page.getByRole("combobox", { name: "Repository for these captures" }).selectOption("github.com/acme/billing");
  expect(await axeViolations(page)).toEqual([]);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/^Saved\./)).toBeVisible();
  await page.getByRole("button", { name: /Back to the Dashboard/ }).click();
  await page.locator("label.seg-opt", { hasText: "All time" }).click();
  await selectListValue(page, "Provider", /mitmproxy/i);
  await expect(repositories.getByRole("option", { name: /github\.com\/acme\/billing/ })).toBeVisible();
  await expect(repositories.getByRole("option", { name: /Unattributed/ })).toHaveCount(0);
});
