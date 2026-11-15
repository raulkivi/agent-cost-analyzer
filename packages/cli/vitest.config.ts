// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The package has no `scripts` field (npm-package.md §4.2), so the root
// `test:cli` script runs this config instead of a workspace test script.
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "**/dist/**"],
  },
});
