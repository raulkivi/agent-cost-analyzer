// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// What the build copies into the package, and where (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/npm-package.md §4.2).
import path from "node:path";
import { describe, expect, it } from "vitest";
import { npmPackageLayout } from "../../server/src/composition/package-layout.js";
import { cliBuildPlan, isShippedDataFile, missingInputs } from "../scripts/build-plan.mts";

const repo = "/repo";
const cli = path.join(repo, "packages", "cli");
const plan = cliBuildPlan(repo);

describe("cliBuildPlan", () => {
  it("builds into packages/cli/dist and keeps the metafile outside it", () => {
    expect(plan.packageDir).toBe(cli);
    expect(plan.distDir).toBe(path.join(cli, "dist"));
    expect(plan.metafilePath).toBe(path.join(cli, "build", "meta.json"));
  });

  it("copies every input to where the package layout reads it at run time", () => {
    const layout = npmPackageLayout(cli);
    expect(plan.copies).toEqual([
      { from: path.join(repo, "packages", "web", "dist"), to: layout.webDir, jsonOnly: false, buildWith: "npm run build --workspace=packages/web" },
      {
        from: path.join(repo, "packages", "mcp-apps", "dist", "views.html"),
        to: layout.appViewsHtml,
        jsonOnly: false,
        buildWith: "npm run build --workspace=packages/mcp-apps",
      },
      { from: path.join(repo, "packages", "server", "fixtures", "learn-scripts"), to: layout.learnScriptsDir, jsonOnly: true },
      { from: path.join(repo, "packages", "server", "fixtures", "vendor-profiles"), to: layout.vendorProfilesDir, jsonOnly: true },
      { from: path.join(repo, "packages", "server", "fixtures", "price-book"), to: layout.priceBookDir, jsonOnly: true },
      { from: path.join(repo, "LICENSE"), to: path.join(cli, "LICENSE"), jsonOnly: false },
    ]);
  });

  it("generates the notices from the root notices into the package", () => {
    expect(plan.rootNoticesPath).toBe(path.join(repo, "THIRD-PARTY-NOTICES.md"));
    expect(plan.noticesPath).toBe(path.join(cli, "THIRD-PARTY-NOTICES.md"));
  });
});

describe("missingInputs", () => {
  it("is empty when every input exists", () => {
    expect(missingInputs(plan, () => true)).toEqual([]);
  });

  it("names each missing input with the command that builds it", () => {
    const present = new Set([path.join(repo, "packages", "server", "fixtures", "learn-scripts")]);
    const missing = missingInputs(plan, (file) => present.has(file) || file.endsWith("LICENSE") || file.includes("fixtures"));
    expect(missing).toEqual([
      `${path.join(repo, "packages", "web", "dist")} is missing: run \`npm run build --workspace=packages/web\` (or \`npm run build\`) first`,
      `${path.join(repo, "packages", "mcp-apps", "dist", "views.html")} is missing: run \`npm run build --workspace=packages/mcp-apps\` (or \`npm run build\`) first`,
    ]);
  });

  it("names a missing source input without a build command", () => {
    expect(missingInputs(plan, (file) => !file.endsWith("price-book"))).toEqual([
      `${path.join(repo, "packages", "server", "fixtures", "price-book")} is missing`,
    ]);
  });
});

describe("isShippedDataFile", () => {
  it("ships only the JSON the loaders read, walking folders", () => {
    expect(isShippedDataFile("learn-scripts/cache-basics.json", false)).toBe(true);
    expect(isShippedDataFile("vendor-profiles", true)).toBe(true);
    expect(isShippedDataFile("vendor-profiles/copilot-price-table.snapshot.yml", false)).toBe(false);
    expect(isShippedDataFile("price-book/README.md", false)).toBe(false);
  });
});
