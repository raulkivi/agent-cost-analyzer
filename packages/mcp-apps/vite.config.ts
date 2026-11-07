// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// ext-apps (and the MCP SDK it builds on) import zod's whole public surface,
// and ext-apps keeps a dynamic `import("zod/v4")`, so the bundler cannot
// prove any export of it unused. Three parts of zod are unreachable from the
// views and cost about 190 KB, so they are cut here:
//  - the locale tables (`z.locales`, 40+ languages): only zod's default
//    English messages are used, so the namespace is reduced to `en`;
//  - `compile` / `withParser` (zod's JIT compiler): ext-apps sets
//    `z.config({ jitless: true })` because the host CSP forbids eval;
//  - `fromJSONSchema`: only a server-side concern.
// Nothing else in zod is touched; toJSONSchema stays (zod's classic schemas
// use it). The stubs throw if ever called, so a future change that does reach
// them fails loudly instead of silently.
const STUBS: Record<string, string> = {
  "\0aca-zod-locales-en-only": 'export { default as en } from "zod/v4/locales/en.js";',
  "\0aca-zod-no-compile": [
    'const gone = () => { throw new Error("zod compile is not bundled in the views build"); };',
    'export const INVALID = Symbol.for("zod.compile.invalid");',
    "export class ZodCompileAsyncError extends Error {}",
    "export class ZodCompileUnsupportedError extends Error {}",
    "export const compile = gone, withParser = gone, compileFn = gone;",
  ].join("\n"),
  "\0aca-zod-no-from-json-schema": 'export const fromJSONSchema = () => { throw new Error("zod fromJSONSchema is not bundled in the views build"); };',
};

const REDIRECTS: { source: string; importer: RegExp; stub: string }[] = [
  { source: "../locales/index.js", importer: /\/zod\/v4\/(classic\/external|core\/index)/, stub: "\0aca-zod-locales-en-only" },
  { source: "./compile.js", importer: /\/zod\/v4\/core\/index/, stub: "\0aca-zod-no-compile" },
  { source: "./from-json-schema.js", importer: /\/zod\/v4\/classic\/external/, stub: "\0aca-zod-no-from-json-schema" },
];

const zodUnusedParts: Plugin = {
  name: "aca-zod-unused-parts",
  enforce: "pre",
  resolveId(source, importer) {
    const from = importer?.replaceAll("\\", "/");
    return REDIRECTS.find((r) => r.source === source && from !== undefined && r.importer.test(from))?.stub;
  },
  load(id) {
    return STUBS[id];
  },
};

// One self-contained dist/views.html (MCP Apps plan §4.3): scripts and CSS
// inline, no external resources. The entry page is views.html (not
// index.html) so the output is dist/views.html, the file the server's
// FileViewSource reads.
export default defineConfig({
  plugins: [zodUnusedParts, react(), viteSingleFile()],
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
    include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"],
  },
});
