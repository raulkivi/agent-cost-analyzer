// Bundles the extension host code (`npm run build`, after the web app's
// extension build has filled media/): dist/extension.js plus esbuild's
// metafile at dist/meta.json, then the learn-scenario fixtures into
// media/learn-scenarios, where the composition root reads them (G4).
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { build } from "esbuild";
import { extensionBundleOptions, extensionPackageDir } from "./esbuild-options.mts";

const distDir = path.join(extensionPackageDir, "dist");
rmSync(distDir, { recursive: true, force: true });
const result = await build(extensionBundleOptions(distDir));
writeFileSync(path.join(distDir, "meta.json"), JSON.stringify(result.metafile, null, 2));

// Fixtures are data, not code, so they're copied rather than bundled.
const serverDir = path.dirname(createRequire(import.meta.url).resolve("@copilot-cost-analyzer/server/package.json"));
const learnScenariosDir = path.join(extensionPackageDir, "media", "learn-scenarios");
rmSync(learnScenariosDir, { recursive: true, force: true });
mkdirSync(path.dirname(learnScenariosDir), { recursive: true });
cpSync(path.join(serverDir, "fixtures", "learn-scenarios"), learnScenariosDir, { recursive: true });
