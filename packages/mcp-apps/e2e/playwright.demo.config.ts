// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { defineConfig } from "@playwright/test";
import { FRAME } from "../../vscode-extension/scripts/demo/ffmpeg-args.mts";
import { DEMO_SCALE } from "./demo/support/demo-layout.js";

// Task 2.2 of docs/plans/docs-refresh-and-demo-recordings.md: close-up
// recordings of the MCP App views (F1 to F3) in the fake MCP Apps host. Its
// own testDir keeps them out of `test:e2e` and CI. Each scene records an MP4
// at the demo frame (1600x1000, the page at DEMO_SCALE) through ffmpeg x11grab in headed
// Chromium under Xvfb (as packages/web's demos do; Playwright's recordVideo
// makes GIFs several times over budget), and `npm run demo:gif -w
// packages/vscode-extension` turns it into a GIF.
//   npm run build --workspace=packages/mcp-apps && npm run demo:record --workspace=packages/mcp-apps
// Masters go to $AICA_DEMO_MASTERS (default <repo>/demo-masters).
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

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
    headless: false,
    viewport: null,
    launchOptions: { ...(executablePath ? { executablePath } : {}), args: ["--ozone-platform=x11", `--force-device-scale-factor=${DEMO_SCALE}`, "--kiosk", "--window-position=0,0", `--window-size=${Math.round(FRAME.width / DEMO_SCALE)},${Math.round(FRAME.height / DEMO_SCALE)}`] },
  },
});
