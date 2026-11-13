// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { defineConfig } from "@playwright/test";

// Task 1.9 of docs/plans/docs-refresh-and-demo-recordings.md: the standalone
// app's demo recordings (W1 to W3). Its own testDir keeps it out of
// `test:e2e` and CI. Each scene records an MP4 at the demo frame (1200x800,
// 1:1) through ffmpeg x11grab that `npm run demo:gif -w packages/vscode-extension` turns into a GIF.
//   npm run build --workspace=packages/web && npm run demo:record --workspace=packages/web
// Masters go to $AICA_DEMO_MASTERS (default <repo>/demo-masters).
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const FRAME = { width: 1200, height: 800 };

export default defineConfig({
  testDir: "./demo",
  testMatch: "**/*.demo.ts",
  outputDir: "./out/demo",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    browserName: "chromium",
    // --ozone-platform=x11 keeps the window in Xvfb (Chromium otherwise sees the desktop screen).
    // Headed in an Xvfb screen of exactly the frame; ffmpeg x11grab records it (see recorder.mts).
    headless: false,
    viewport: null,
    launchOptions: { ...(executablePath ? { executablePath } : {}), args: ["--ozone-platform=x11", "--kiosk", "--window-position=0,0", `--window-size=${FRAME.width},${FRAME.height}`] },
  },
});
