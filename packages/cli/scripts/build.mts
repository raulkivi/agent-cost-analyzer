// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Builds the npm package (`npm run build:cli`, the last step of `npm run
// build`, as it needs the web app and the MCP App views built):
// dist/cli.js and its chunks, the metafile at build/meta.json (not shipped),
// the web app, the views, the JSON data, LICENSE and THIRD-PARTY-NOTICES.md.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { cliBuildPlan, isShippedDataFile, missingInputs } from "./build-plan.mts";
import { cliBundleOptions } from "./esbuild-options.mts";
import { generateNotices, readBundledPackagesList } from "../../../scripts/third-party-notices.mts";

const plan = cliBuildPlan(path.resolve(import.meta.dirname, "..", "..", ".."));

const missing = missingInputs(plan, existsSync);
if (missing.length > 0) {
  process.stderr.write(`packages/cli build:\n${missing.join("\n")}\n`);
  process.exit(1);
}

rmSync(plan.distDir, { recursive: true, force: true });
const { metafile } = await build(cliBundleOptions(plan.packageDir));
mkdirSync(path.dirname(plan.metafilePath), { recursive: true });
writeFileSync(plan.metafilePath, JSON.stringify(metafile, null, 2));

const manifest = JSON.parse(readFileSync(path.join(plan.packageDir, "package.json"), "utf8")) as { name: string; version: string };
writeFileSync(
  plan.noticesPath,
  generateNotices({
    metafile,
    workingDir: plan.packageDir,
    extraParts: [
      { label: "web", dirs: readBundledPackagesList(plan.webPackagesPath, "web") },
      { label: "views", dirs: readBundledPackagesList(plan.viewsPackagesPath, "views") },
    ],
    rootNotices: readFileSync(plan.rootNoticesPath, "utf8"),
    packageName: manifest.name,
    packageVersion: manifest.version,
  }),
);

const jsonOnly = (source: string): boolean => isShippedDataFile(source, statSync(source).isDirectory());
for (const step of plan.copies) {
  rmSync(step.to, { recursive: true, force: true });
  mkdirSync(path.dirname(step.to), { recursive: true });
  cpSync(step.from, step.to, { recursive: true, ...(step.jsonOnly ? { filter: jsonOnly } : {}) });
}

const kB = (bytes: number): string => `${(bytes / 1000).toFixed(1)} kB`;
for (const file of readdirSync(plan.distDir).filter((name) => name.endsWith(".js"))) {
  process.stdout.write(`packages/cli/dist/${file}  ${kB(statSync(path.join(plan.distDir, file)).size)}\n`);
}
