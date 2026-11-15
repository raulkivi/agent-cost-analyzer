// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The npm-package job is a matrix that is skipped on docs-only PRs, so its
// per-leg check names never appear there. The ruleset requires one summary
// check instead (npm-package.md task NP9); these tests keep it honest.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";

const path = new URL("../.github/workflows/ci.yml", import.meta.url);
const { jobs } = parse(readFileSync(path, "utf8"));
const result = jobs["npm-package-result"];

test("a summary job follows the npm-package matrix", () => {
  assert.ok(result, "npm-package-result job is missing");
  assert.equal(result.name, "npm-package-result");
  assert.deepEqual([result.needs].flat(), ["npm-package"]);
});

test("it always runs, so the required check reports on docs-only PRs too", () => {
  assert.match(String(result.if), /always\(\)/);
});

test("it fails when any matrix leg failed or was canceled, and passes when skipped", () => {
  const script = result.steps.map((step) => step.run ?? "").join("\n");
  assert.match(JSON.stringify(result.steps), /needs\.npm-package\.result/);
  assert.match(script, /success\|skipped|skipped\|success/);
  assert.match(script, /exit 1/);
});

test("it needs no permissions or secrets", () => {
  assert.deepEqual(result.permissions, {});
  assert.doesNotMatch(JSON.stringify(result), /secrets\./);
});
