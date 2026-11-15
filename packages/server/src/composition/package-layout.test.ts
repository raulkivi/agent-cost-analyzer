// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bundledDataDirsOf, npmPackageLayout } from "./package-layout.js";

describe("npmPackageLayout", () => {
  it("places every runtime file where the npm tarball keeps it (npm-package.md §4.2)", () => {
    const root = path.join(path.sep, "opt", "agent-cost-analyzer");

    expect(npmPackageLayout(root)).toEqual({
      learnScriptsDir: path.join(root, "dist", "data", "learn-scripts"),
      vendorProfilesDir: path.join(root, "dist", "data", "vendor-profiles"),
      priceBookDir: path.join(root, "dist", "data", "price-book"),
      appViewsHtml: path.join(root, "dist", "mcp-apps", "views.html"),
      webDir: path.join(root, "dist", "web"),
      packageJsonPath: path.join(root, "package.json"),
    });
  });
});

describe("bundledDataDirsOf", () => {
  it("picks the three data folders out of a layout", () => {
    const layout = npmPackageLayout(path.join(path.sep, "pkg"));

    expect(bundledDataDirsOf(layout)).toEqual({
      learnScriptsDir: layout.learnScriptsDir,
      vendorProfilesDir: layout.vendorProfilesDir,
      priceBookDir: layout.priceBookDir,
    });
  });

  it("is empty without a layout, so each loader keeps its own default", () => {
    expect(bundledDataDirsOf(undefined)).toEqual({});
  });
});
