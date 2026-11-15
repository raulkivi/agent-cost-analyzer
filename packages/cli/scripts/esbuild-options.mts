// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The npm package's esbuild options (npm-package.md §4.2), shared by the
// build (build.mts) and its tests, so the tests check what ships.
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildOptions } from "esbuild";

export const cliPackageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// On top of every output file. express and other CommonJS dependencies call
// require() at run time, which an ES module lacks (npm-package.md §7). The
// SPDX lines are there because esbuild keeps only `@license`/`/*!` comments,
// not the sources' own SPDX headers.
const BANNER = [
  "// SPDX-FileCopyrightText: 2026 Raul Kivi",
  "// SPDX-License-Identifier: MIT",
  "// Bundled third-party code: see THIRD-PARTY-NOTICES.md in this package.",
  'import { createRequire as __agentCostAnalyzerCreateRequire } from "node:module";',
  "const require = __agentCostAnalyzerCreateRequire(import.meta.url);",
].join("\n");

export function cliBundleOptions(packageDir = cliPackageDir) {
  return {
    absWorkingDir: packageDir,
    entryPoints: [path.join(packageDir, "src", "cli.ts")],
    outdir: path.join(packageDir, "dist"),
    entryNames: "[name]",
    // Chunks sit beside cli.js, so code in any of them finds the package
    // root one level up from its own import.meta.url (src/cli.ts).
    chunkNames: "chunk-[hash]",
    bundle: true,
    splitting: true,
    platform: "node",
    format: "esm",
    target: "node22.18",
    // node:sqlite and the other builtins are the user's own Node.
    external: ["node:*"],
    // Prefer each dependency's ESM build: jsonc-parser's UMD main loads its
    // parts with a require() esbuild can't follow (as in the extension).
    mainFields: ["module", "main"],
    // Readable, so users can read what npx runs (D9).
    minify: false,
    legalComments: "inline",
    sourcemap: false,
    // For THIRD-PARTY-NOTICES.md; the build writes it outside dist/.
    metafile: true,
    banner: { js: BANNER },
    logLevel: "warning",
  } satisfies BuildOptions;
}

// Outside dist/ (and `files`), so it never ships.
export function cliMetafilePath(packageDir = cliPackageDir): string {
  return path.join(packageDir, "build", "meta.json");
}
