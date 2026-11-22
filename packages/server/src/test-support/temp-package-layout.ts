// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { npmPackageLayout, type PackageLayout } from "../composition/package-layout.js";

const FIXTURES_DIR = fileURLToPath(new URL("../../fixtures/", import.meta.url));

// What the temp layout holds, chosen to differ from this package's own
// fixtures/ (18 learn scripts, 6 vendor profiles, 4 price-book channels),
// so a test can tell which folder a composition root read.
export const TEMP_LAYOUT = {
  version: "9.8.7-layout",
  learnScenarioIds: ["cache-basics"],
  vendorIds: ["anthropic"],
  priceBookChannels: ["anthropic-api", "github-copilot"],
  viewsMarker: "views from the temp package layout",
} as const;

export interface TempPackageLayout {
  root: string;
  layout: PackageLayout;
  remove(): void;
}

function copyInto(dir: string, from: string, files: readonly string[]): void {
  mkdirSync(dir, { recursive: true });
  for (const file of files) copyFileSync(path.join(FIXTURES_DIR, from, file), path.join(dir, file));
}

// The npm tarball's layout (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/npm-package.md §4.2) in a temp folder, with a
// minimal set of the real JSON data.
export function writeTempPackageLayout(): TempPackageLayout {
  const root = mkdtempSync(path.join(tmpdir(), "package-layout-"));
  const layout = npmPackageLayout(root);
  copyInto(layout.learnScriptsDir, "learn-scripts", TEMP_LAYOUT.learnScenarioIds.map((id) => `${id}.json`));
  copyInto(layout.vendorProfilesDir, "vendor-profiles", TEMP_LAYOUT.vendorIds.map((id) => `${id}.json`));
  copyInto(layout.priceBookDir, "price-book", TEMP_LAYOUT.priceBookChannels.map((channel) => `${channel}.json`));
  mkdirSync(path.dirname(layout.appViewsHtml), { recursive: true });
  writeFileSync(layout.appViewsHtml, `<!doctype html><html><head><meta name="aca-brand" content=""></head><body>${TEMP_LAYOUT.viewsMarker}</body></html>`);
  mkdirSync(layout.webDir, { recursive: true });
  writeFileSync(path.join(layout.webDir, "index.html"), "<!doctype html><title>web</title>");
  writeFileSync(layout.packageJsonPath, JSON.stringify({ name: "agent-cost-analyzer", version: TEMP_LAYOUT.version }));
  return { root, layout, remove: () => rmSync(root, { recursive: true, force: true }) };
}
