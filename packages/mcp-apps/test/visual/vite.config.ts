// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// The A14 visual harness (harness.tsx), built as one file the same way as
// dist/views.html so the screenshots show the real CSS cascade. Build with
//   npx vite build --config test/visual/vite.config.ts --outDir <scratch dir>
// from packages/mcp-apps. Never part of the package's own build.
const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  base: "./",
  plugins: [react(), viteSingleFile()],
  build: { target: "es2022", assetsInlineLimit: 0, reportCompressedSize: false, rollupOptions: { input: path.join(here, "harness.html") } },
});
