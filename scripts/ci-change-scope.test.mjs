// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyChanges, parseChangedPaths } from "./ci-change-scope.mjs";

const docsOnly = (paths) => classifyChanges(paths).docsOnly;

test("an empty change list is not docs-only (fail safe)", () => {
  const result = classifyChanges([]);
  assert.equal(result.docsOnly, false);
  assert.ok(result.reasons.length > 0);
});

test("docs/** and root-level markdown are docs-only", () => {
  assert.equal(docsOnly(["docs/plans/mcp-apps.md", "README.md"]), true);
  assert.equal(docsOnly(["docs/diagrams/a.drawio.svg", "AGENTS.md"]), true);
});

test("one code path makes the change set code", () => {
  const result = classifyChanges(["docs/vision.md", "packages/web/src/a.ts"]);
  assert.equal(result.docsOnly, false);
  assert.deepEqual(result.reasons, ["packages/web/src/a.ts"]);
});

for (const path of [
  "packages/domain/README.md",
  ".github/workflows/ci.yml",
  "scripts/ci-change-scope.mjs",
  "package.json",
  "package-lock.json",
  "tsconfig.base.json",
  "eslint.config.mjs",
  "CHANGELOG.md",
  "packages/vscode-extension/CHANGELOG.md",
  "src/docs/notes.md",
]) {
  test(`${path} is code`, () => assert.equal(docsOnly([path]), false));
}

// Docs that a test reads stay code (each is named in the classifier).
for (const path of [
  "docs/vscode-extension-guide.md",
  "docs/UserGuide.md",
  "docs/threat-model.md",
  "CONTRIBUTING.md",
  "docs/scenarios/01-cache-basics-8-turn-session.md",
  "docs/plans/mcp-apps-spike-results/claude-dark.json",
  "docs/plans/mcp-apps-a24-results/vscode-hc-dark-theme.jsonc",
]) {
  test(`${path} is code because a test reads it`, () =>
    assert.equal(docsOnly([path]), false));
}

test("path lookalikes are not docs", () => {
  assert.equal(docsOnly(["docsx/a.md"]), false);
  assert.equal(docsOnly(["not-docs/a.md"]), false);
  assert.equal(docsOnly(["docs/../scripts/a.mjs"]), false);
});

test("parseChangedPaths drops blanks and trims", () => {
  assert.deepEqual(parseChangedPaths("a.md\n\n docs/b.md \r\n"), [
    "a.md",
    "docs/b.md",
  ]);
});
