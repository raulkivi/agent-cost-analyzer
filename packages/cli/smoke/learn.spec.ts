// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { expect, test } from "@playwright/test";
import { isLoopbackRequest } from "./checks.mts";

// https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/npm-package.md §4.8 step 5: the web app the installed package serves loads
// from its own origin. The web-e2e suite covers the screens; this proves the
// packaged build runs: Learn mode renders a scenario, nothing logs an error,
// and no request leaves 127.0.0.1 (no remote font, script or call).
test("the packaged app renders a Learn scenario from 127.0.0.1 alone, without console errors", async ({ page, baseURL }) => {
  expect(baseURL, "AGENT_COST_ANALYZER_SMOKE_URL is not set").toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

  const errors: string[] = [];
  const remote: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (!isLoopbackRequest(request.url())) remote.push(request.url());
  });

  await page.goto("/");
  const scenarios = page.getByRole("list", { name: "Scenarios" });
  await scenarios.getByRole("button").first().click();
  await expect(page.locator("table tbody tr").first()).toBeVisible();
  // Fonts, lazy chunks and the scenario's data have been requested by now.
  await page.waitForLoadState("networkidle");

  expect(errors, "console errors").toEqual([]);
  expect(remote, "requests that left 127.0.0.1").toEqual([]);
});
