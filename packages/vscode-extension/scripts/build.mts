// Bundles the extension's code (`npm run build`, after the web app's
// extension build has filled media/): the host's dist/extension.js with
// esbuild's metafile at dist/meta.json, and the MCP child process's
// dist/mcp-stdio.js with dist/meta-mcp-stdio.json (step 10.8). Then the
// learn-scenario fixtures go into media/learn-scenarios, where the
// composition root reads them (G4).
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
const learnScenariosDir = path.join(extensionPackageDir, "media", "learn-scenarios");
rmSync(learnScenariosDir, { recursive: true, force: true });
mkdirSync(path.dirname(learnScenariosDir), { recursive: true });
cpSync(path.join(serverDir, "fixtures", "learn-scenarios"), learnScenariosDir, { recursive: true });
