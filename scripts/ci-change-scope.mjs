// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Classifies a PR's changed paths so CI can skip the heavy UI jobs on a
// docs-only change: `git diff --name-only ... | node scripts/ci-change-scope.mjs`
// prints `docs_only=true|false` for $GITHUB_OUTPUT.
import console from "node:console";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import process from "node:process";

// Docs a test reads count as code, so editing one runs the jobs that read it.
const DOCS_READ_BY_TESTS = [
  // packages/vscode-extension/src/docs.test.ts (LINKED_DOCS and the guide's checks)
  "docs/vscode-extension-guide.md",
  "docs/UserGuide.md",
  "docs/threat-model.md",
  "CONTRIBUTING.md",
  // packages/server/src/services/learn-simulation/scenario-docs/docs-drift.test.ts
  // and `npm run scenarios:docs:check`
  "docs/scenarios/",
  // packages/mcp-apps/test/theme/host-sets.ts, test/visual/harness.tsx,
  // e2e/support/host-fixture.ts, src/theme/apply-host-theme.test.ts (G6 recordings)
  "docs/plans/mcp-apps-spike-results/",
  // packages/mcp-apps/test/theme/host-sets.ts (HC recordings)
  "docs/plans/mcp-apps-a24-results/",
];

const isCodeDoc = (path) =>
  DOCS_READ_BY_TESTS.some((entry) =>
    entry.endsWith("/") ? path.startsWith(entry) : path === entry,
  );

const isChangelog = (path) => /(^|\/)CHANGELOG\.md$/.test(path);
const isTraversal = (path) => path.split("/").includes("..");

function isDocsPath(path) {
  if (isTraversal(path) || isChangelog(path) || isCodeDoc(path)) return false;
  return path.startsWith("docs/") || /^[^/]+\.md$/.test(path);
}

/** Docs-only when every path is documentation no test reads; `reasons` lists the code paths. */
export function classifyChanges(paths) {
  if (paths.length === 0) {
    return { docsOnly: false, reasons: ["no changed paths (fail safe)"] };
  }
  const reasons = paths.filter((path) => !isDocsPath(path));
  return { docsOnly: reasons.length === 0, reasons };
}

export function parseChangedPaths(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { docsOnly, reasons } = classifyChanges(
    parseChangedPaths(readFileSync(0, "utf8")),
  );
  if (!docsOnly) console.error(`code changes: ${reasons.slice(0, 10).join(", ")}`);
  console.log(`docs_only=${docsOnly}`);
}
