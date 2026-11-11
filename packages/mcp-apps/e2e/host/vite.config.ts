// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// The fake MCP Apps host's page (host.html, host-page.ts) as one file, so
// the suite serves it from memory with nothing else to load. Built by
// `npm run test:e2e` into e2e/host/dist/; never part of dist/views.html.
const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  base: "./",
  logLevel: "warn",
  plugins: [viteSingleFile()],
  build: {
    outDir: path.join(here, "dist"),
    emptyOutDir: true,
    target: "es2022",
    assetsInlineLimit: 0,
    reportCompressedSize: false,
    rollupOptions: { input: path.join(here, "host.html") },
  },
});
