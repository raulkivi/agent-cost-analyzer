// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { axeViolations } from "../support/axe.js";
import { expect, openDashboard, test } from "../support/app-fixture.js";

// The Overview (the Dashboard's landing view in Analyze mode) is axe-clean.
// The light and dark Playwright projects run it in both colour modes.
test("the Overview has no axe violations", async ({ page, app }) => {
  await openDashboard(page, app.baseURL);
  expect(await axeViolations(page)).toEqual([]);
});
