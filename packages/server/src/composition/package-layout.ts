// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import path from "node:path";

// The bundled data folders, JSON only. Each loader defaults an omitted
// folder to this package's own fixtures/, found through import.meta.url,
// which only works when the code runs from source (dev).
export interface BundledDataDirs {
  learnScriptsDir?: string;
  vendorProfilesDir?: string;
  priceBookDir?: string;
}

// Where a packaged build keeps the files the app reads at run time
// (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/npm-package.md §4.2 "Paths"). A bundle can't find them through
// import.meta.url, so its entry point passes them to both composition roots
// (standalone-app.ts, mcp/standalone-mcp-server.ts), as the extension
// passes its media/ paths (G4, vscode-extension.md §2.2).
export interface PackageLayout extends Required<BundledDataDirs> {
  // The built MCP App views (packages/mcp-apps/dist/views.html).
  appViewsHtml: string;
  // The built web app (packages/web/dist), for the CLI's static serving.
  webDir: string;
  // The package.json whose version /api/health and the MCP server report.
  packageJsonPath: string;
}

// The npm tarball's layout under its package root (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/npm-package.md §4.2).
export function npmPackageLayout(packageRoot: string): PackageLayout {
  const dist = path.join(packageRoot, "dist");
  return {
    learnScriptsDir: path.join(dist, "data", "learn-scripts"),
    vendorProfilesDir: path.join(dist, "data", "vendor-profiles"),
    priceBookDir: path.join(dist, "data", "price-book"),
    appViewsHtml: path.join(dist, "mcp-apps", "views.html"),
    webDir: path.join(dist, "web"),
    packageJsonPath: path.join(packageRoot, "package.json"),
  };
}

// No layout gives no folders, so every loader keeps its dev default.
export function bundledDataDirsOf(layout: PackageLayout | undefined): BundledDataDirs {
  if (layout === undefined) return {};
  const { learnScriptsDir, vendorProfilesDir, priceBookDir } = layout;
  return { learnScriptsDir, vendorProfilesDir, priceBookDir };
}
