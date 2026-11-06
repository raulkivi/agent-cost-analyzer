import { defineConfig } from "@playwright/test";

// Phase 15 step 15.9 (docs/plans/cost-by-repository-and-project.md §12.4):
// the standalone app's usage-scenario suite. Each test starts the real
// server and the web build (packages/web/dist) over its own seeded fixture
// home and a fixed clock (support/app-fixture.ts). Headless Chromium from
// the Playwright already pinned for the UI check. No retries (§12.4.3): a
// flaky scenario is fixed, not re-run.
//   npm run build --workspace=packages/web && npm run test:e2e --workspace=packages/web
// CI installs the Chromium this Playwright expects; a machine with another
// pre-installed build can point at it (as the UI check honours too).
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
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
});
