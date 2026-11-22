// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { defineConfig } from "@playwright/test";

// The npm-package smoke's UI check (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/npm-package.md §4.8 step 5, §10): the
// page the installed package serves, at AGENT_COST_ANALYZER_SMOKE_URL, which
// scripts/npm-package-smoke.mts sets after starting the bin. Headless
// Chromium from the Playwright the repository pins; a machine with another
// pre-installed build can point at it, as the web suite allows. No retries.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  outputDir: process.env.AGENT_COST_ANALYZER_SMOKE_OUT ?? "./out/playwright",
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    browserName: "chromium",
    headless: true,
    baseURL: process.env.AGENT_COST_ANALYZER_SMOKE_URL,
    screenshot: "only-on-failure",
    trace: "off",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
});
