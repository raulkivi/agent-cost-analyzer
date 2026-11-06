// Bundles the extension's code (`npm run build`, after the web app's
// extension build has filled media/): the host's dist/extension.js with
// esbuild's metafile at dist/meta.json, and the MCP child process's
// dist/mcp-stdio.js with dist/meta-mcp-stdio.json (step 10.8). Then the
// simulation's data goes into media/learn-scripts, media/vendor-profiles and
// media/price-book, where the composition root reads it (G4).
import { cpSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { build } from "esbuild";
import { extensionBundleOptions, extensionPackageDir, mcpServerBundleOptions } from "./esbuild-options.mts";

const distDir = path.join(extensionPackageDir, "dist");
rmSync(distDir, { recursive: true, force: true });
const extension = await build(extensionBundleOptions(distDir));
writeFileSync(path.join(distDir, "meta.json"), JSON.stringify(extension.metafile, null, 2));
const mcpServer = await build(mcpServerBundleOptions(distDir));
writeFileSync(path.join(distDir, "meta-mcp-stdio.json"), JSON.stringify(mcpServer.metafile, null, 2));

// Fixtures are data, not code, so they're copied rather than bundled.
const serverDir = path.dirname(createRequire(import.meta.url).resolve("@agent-cost-analyzer/server/package.json"));
// Step 13.6: the vendor-aware simulation's scripts and vendor profiles. Only
// the JSON the loaders read ships; the price-table snapshot beside the
// profiles is a CI-diff input (step 13.9), not runtime data. The profiles
// read their prices from the price book beside them (Phase 15 step 15.5).
const jsonOnly = (source: string): boolean => statSync(source).isDirectory() || source.endsWith(".json");
for (const name of ["learn-scripts", "vendor-profiles", "price-book"]) {
  const target = path.join(extensionPackageDir, "media", name);
  rmSync(target, { recursive: true, force: true });
  cpSync(path.join(serverDir, "fixtures", name), target, { recursive: true, filter: jsonOnly });
}
