// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { defineConfig } from "@playwright/test";

// Step 10.17 G5 (docs/plans/release-ui-gate.md): the MCP App views in a fake
// MCP Apps host. Each test starts the real stdio MCP server over a seeded
// fixture home and shows the built dist/views.html in an iframe through
// ext-apps' AppBridge (support/host-fixture.ts). Headless Chromium from the
// Playwright the web suite pins. No retries: a flaky spec is fixed, not re-run.
//   npm run build --workspace=packages/mcp-apps && npm run test:e2e --workspace=packages/mcp-apps
// A machine with another pre-installed Chromium can point at it, as the web suite allows.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: "./specs",
  outputDir: "./out",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    browserName: "chromium",
    headless: true,
    viewport: { width: 1280, height: 900 },
    screenshot: "only-on-failure",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
});
