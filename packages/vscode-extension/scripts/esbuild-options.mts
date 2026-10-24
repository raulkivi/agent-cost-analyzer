import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildOptions } from "esbuild";

export const extensionPackageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// What every bundle the extension ships shares (vscode-extension.md G9):
// one CommonJS file for the Node inside VS Code's Electron (Node 24 for
// VS Code 1.143, step 10.0). node: builtins stay external (esbuild's
// default for platform "node"), so node:sqlite is the host's own.
function nodeBundleOptions(entry: string, outfile: string) {
  return {
    absWorkingDir: extensionPackageDir,
    entryPoints: [path.join(extensionPackageDir, "src", entry)],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node24",
    // Prefer each dependency's ESM build: jsonc-parser's UMD main loads its
    // parts with a require() esbuild can't follow, so it would fail at
    // runtime (the bundle-load test catches this).
    mainFields: ["module", "main"],
    outfile,
    metafile: true,
    logLevel: "warning",
    // The server's import.meta.url uses only resolve defaults the extension
    // always overrides (G4: fixtures dir and version are injected), so the
    // CJS bundle's empty import.meta is never read.
    logOverride: { "empty-import-meta": "silent" },
  } satisfies BuildOptions;
}

// The extension host's bundle, with `vscode` supplied by the host. Shared
// by the build (scripts/build.mts) and the bundle-boundary test, so the
// test checks exactly what ships.
export function extensionBundleOptions(outDir = path.join(extensionPackageDir, "dist")) {
  return {
    ...nodeBundleOptions("extension.ts", path.join(outDir, "extension.js")),
    external: ["vscode"],
  } satisfies BuildOptions;
}

// The MCP server's child process (step 10.8, D7), which VS Code starts
// with its own Electron as Node (ELECTRON_RUN_AS_NODE). It has no `vscode`
// API, so `vscode` isn't external: an import of it would fail the build.
export function mcpServerBundleOptions(outDir = path.join(extensionPackageDir, "dist")) {
  return nodeBundleOptions(path.join("mcp", "stdio.ts"), path.join(outDir, "mcp-stdio.js"));
}
