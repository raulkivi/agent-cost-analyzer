// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The real-client check (mcp-client-setup.md §7 item 7, MC8) is outside
// `npm test` and CI: it runs only through `npm run test:real-clients:mcp-setup`.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.real.test.mts"],
    // Real clients start servers; one run at a time, each test with room to do so.
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
});
