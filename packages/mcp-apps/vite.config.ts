// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { bundledPackagesPlugin } from "../web/vite-plugins/bundled-packages.ts";

// One self-contained dist/views.html (MCP Apps plan §4.3): scripts and CSS
// inline, no external resources. The entry page is views.html (not
// index.html) so the output is dist/views.html, the file the server's
// FileViewSource reads.
export default defineConfig({
  // The list of bundled npm packages feeds the npm package's third-party
  // notices (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/npm-package.md §4.9); the plugin is shared with the web build.
  plugins: [react(), viteSingleFile(), bundledPackagesPlugin(fileURLToPath(new URL("./build/bundled-packages.json", import.meta.url)))],
  build: {
    target: "es2022",
    minify: true,
    cssMinify: true,
    // Nothing may be fetched at runtime, so nothing is inlined as data either.
    assetsInlineLimit: 0,
    reportCompressedSize: false,
    rollupOptions: { input: "views.html" },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/setupTests.ts"],
    include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}", "e2e/support/**/*.test.ts", "e2e/demo/**/*.test.ts"],
  },
});
