// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// One self-contained dist/views.html (MCP Apps plan §4.3): scripts and CSS
// inline, no external resources. The entry page is views.html (not
// index.html) so the output is dist/views.html, the file the server's
// FileViewSource reads.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
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
    include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}", "e2e/support/**/*.test.ts"],
  },
});
