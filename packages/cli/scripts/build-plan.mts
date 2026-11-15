// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// What the npm package's build reads and writes (npm-package.md §4.2): pure
// paths, so the build (build.mts) and the tests share them.
import path from "node:path";
import { npmPackageLayout } from "../../server/src/composition/package-layout.ts";
import { cliMetafilePath } from "./esbuild-options.mts";

export interface CopyStep {
  from: string;
  to: string;
  // Data folders ship only the JSON the loaders read.
  jsonOnly: boolean;
  // How to make a built input that is missing.
  buildWith?: string;
}

export interface CliBuildPlan {
  packageDir: string;
  distDir: string;
  metafilePath: string;
  // The package lists the web and MCP Apps Vite builds write (not shipped).
  webPackagesPath: string;
  viewsPackagesPath: string;
  rootNoticesPath: string;
  noticesPath: string;
  copies: CopyStep[];
}

// Every target comes from the layout the CLI reads at run time, so the build
// and the package can't disagree on a path.
export function cliBuildPlan(repoRoot: string): CliBuildPlan {
  const packageDir = path.join(repoRoot, "packages", "cli");
  const layout = npmPackageLayout(packageDir);
  const fixtures = path.join(repoRoot, "packages", "server", "fixtures");
  return {
    packageDir,
    distDir: path.join(packageDir, "dist"),
    metafilePath: cliMetafilePath(packageDir),
    webPackagesPath: path.join(repoRoot, "packages", "web", "build", "bundled-packages.json"),
    viewsPackagesPath: path.join(repoRoot, "packages", "mcp-apps", "build", "bundled-packages.json"),
    rootNoticesPath: path.join(repoRoot, "THIRD-PARTY-NOTICES.md"),
    noticesPath: path.join(packageDir, "THIRD-PARTY-NOTICES.md"),
    copies: [
      {
        from: path.join(repoRoot, "packages", "web", "dist"),
        to: layout.webDir,
        jsonOnly: false,
        buildWith: "npm run build --workspace=packages/web",
      },
      {
        from: path.join(repoRoot, "packages", "mcp-apps", "dist", "views.html"),
        to: layout.appViewsHtml,
        jsonOnly: false,
        buildWith: "npm run build --workspace=packages/mcp-apps",
      },
      { from: path.join(fixtures, "learn-scripts"), to: layout.learnScriptsDir, jsonOnly: true },
      { from: path.join(fixtures, "vendor-profiles"), to: layout.vendorProfilesDir, jsonOnly: true },
      { from: path.join(fixtures, "price-book"), to: layout.priceBookDir, jsonOnly: true },
      { from: path.join(repoRoot, "LICENSE"), to: path.join(packageDir, "LICENSE"), jsonOnly: false },
    ],
  };
}

export function missingInputs(plan: CliBuildPlan, exists: (file: string) => boolean): string[] {
  return plan.copies
    .filter((step) => !exists(step.from))
    .map((step) =>
      step.buildWith === undefined ? `${step.from} is missing` : `${step.from} is missing: run \`${step.buildWith}\` (or \`npm run build\`) first`,
    );
}

// The filter for a data folder's copy: folders are walked, files ship only as JSON
// (vendor-profiles' price-table snapshot is a CI-diff input, not run-time data).
export function isShippedDataFile(file: string, isDirectory: boolean): boolean {
  return isDirectory || file.endsWith(".json");
}
