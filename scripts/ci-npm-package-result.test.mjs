// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The npm-package job is a matrix that is skipped on docs-only PRs, so its
// per-leg check names never appear there. The ruleset requires one summary
// check instead (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/npm-package.md task NP9); these tests keep it honest.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";

const path = new URL("../.github/workflows/ci.yml", import.meta.url);
const { jobs } = parse(readFileSync(path, "utf8"));
const result = jobs["npm-package-result"];

test("a summary job follows the npm-package matrix", () => {
  assert.ok(result, "npm-package-result job is missing");
  assert.equal(result.name, "npm-package-result");
  assert.deepEqual([result.needs].flat(), ["changes", "npm-package"]);
});

test("it always runs, so the required check reports on docs-only PRs too", () => {
  assert.match(String(result.if), /always\(\)/);
});

test("it fails when any matrix leg failed or was canceled, and passes when skipped", () => {
  const script = result.steps.map((step) => step.run ?? "").join("\n");
  assert.match(JSON.stringify(result.steps), /needs\.npm-package\.result/);
  assert.match(script, /exit 1/);
});

// Runs the step's script for real, so the behavior is tested, not its wording.
const step = result.steps.find((s) => s.run);
const passes = (changes, matrix, docsOnly) =>
  spawnSync("bash", ["-c", step.run], {
    env: { PATH: process.env.PATH, CHANGES: changes, RESULT: matrix, DOCS_ONLY: docsOnly },
  }).status === 0;

test("the step reads the changes result, its docs_only output and the matrix result", () => {
  const env = JSON.stringify(step.env);
  assert.match(env, /needs\.changes\.result/);
  assert.match(env, /needs\.changes\.outputs\.docs_only/);
  assert.match(env, /needs\.npm-package\.result/);
});

test("a skipped matrix passes only on a docs-only change scope", () => {
  assert.ok(passes("success", "skipped", "true"));
  assert.ok(!passes("success", "skipped", "false"));
  assert.ok(!passes("success", "skipped", ""));
});

test("a run canceled before the matrix (changes canceled or failed) fails", () => {
  for (const changes of ["cancelled", "failure", "skipped"]) { // codespell:ignore cancelled
    assert.ok(!passes(changes, "skipped", "true"), changes);
    assert.ok(!passes(changes, "success", "false"), changes);
  }
});

test("a successful matrix passes; a failed or canceled one fails", () => {
  assert.ok(passes("success", "success", "false"));
  assert.ok(!passes("success", "failure", "false"));
  assert.ok(!passes("success", "cancelled", "false")); // codespell:ignore cancelled
});

test("it needs no permissions or secrets", () => {
  assert.deepEqual(result.permissions, {});
  assert.doesNotMatch(JSON.stringify(result), /secrets\./);
});
