import { readdirSync } from "node:fs";
import path from "node:path";
import type { BuildOptions } from "esbuild";
import { extensionPackageDir } from "./esbuild-options.mts";

// The real-VS Code integration suite (step 10.9): its sources, and where
// .vscode-test.mjs's `files` glob finds the bundles.
export const integrationTestSourceDir = path.join(extensionPackageDir, "src", "test", "integration");
export const integrationTestOutDir = path.join(extensionPackageDir, "out", "integration");

// Every test file of the suite.
export function integrationTestEntryPoints(): string[] {
  return readdirSync(integrationTestSourceDir)
    .filter((file) => file.endsWith(".test.ts"))
    .sort()
    .map((file) => path.join(integrationTestSourceDir, file));
}

// One CommonJS file per test file, which @vscode/test-cli's mocha runner
// require()s inside the Extension Development Host: `vscode` comes from the
// host, and mocha's TDD globals (suite, test) from the runner, so neither is
// bundled. Everything else is, like the extension itself: the tests import
// its pure modules and the MCP SDK's client. Kept apart from
// esbuild-options.mts because nothing here ships.
export function integrationTestBundleOptions(outDir = integrationTestOutDir) {
  return {
    absWorkingDir: extensionPackageDir,
    entryPoints: integrationTestEntryPoints(),
    outdir: outDir,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    // As in esbuild-options.mts: prefer each dependency's ESM build.
    mainFields: ["module", "main"],
    external: ["vscode"],
    sourcemap: "inline",
    logLevel: "warning",
  } satisfies BuildOptions;
}
