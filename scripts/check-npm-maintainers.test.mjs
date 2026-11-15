// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkMaintainers } from "./check-npm-maintainers.mjs";

const owner = "raulkivi";

test("passes when the owner is the only maintainer", () => {
  assert.equal(checkMaintainers(`["raulkivi <me@example.com>"]`, owner).ok, true);
  assert.equal(checkMaintainers(`"raulkivi <me@example.com>"`, owner).ok, true);
  assert.equal(checkMaintainers(`[{"name":"raulkivi","email":"x"}]`, owner).ok, true);
});

test("fails when another maintainer exists", () => {
  const result = checkMaintainers(`["raulkivi <a@b.c>","mallory <m@b.c>"]`, owner);
  assert.equal(result.ok, false);
  assert.match(result.message, /mallory/);
});

test("fails when the owner is not a maintainer", () => {
  assert.equal(checkMaintainers(`["mallory <m@b.c>"]`, owner).ok, false);
});

test("fails closed on empty, missing or unparsable output", () => {
  assert.equal(checkMaintainers(`[]`, owner).ok, false);
  assert.equal(checkMaintainers(``, owner).ok, false);
  assert.equal(checkMaintainers(`not json`, owner).ok, false);
});

test("a look-alike name is not the owner", () => {
  assert.equal(checkMaintainers(`["raulkivi2 <a@b.c>"]`, owner).ok, false);
});

// The CLI reads the `npm view … --json` output from a file: a synchronous
// read of a pipe whose writer is still waiting on the registry fails with
// EAGAIN (release run 43764564560).
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const script = new URL("./check-npm-maintainers.mjs", import.meta.url).pathname;
const runWithFile = (content) => {
  const file = join(mkdtempSync(join(tmpdir(), "maintainers-")), "maintainers.json");
  if (content !== undefined) writeFileSync(file, content);
  return spawnSync(process.execPath, [script, owner, file], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
};

test("the CLI reads the maintainers from a file argument", () => {
  assert.equal(runWithFile(JSON.stringify(["raulkivi <owner@example.com>"])).status, 0);
  assert.equal(runWithFile(JSON.stringify(["someone-else"])).status, 1);
});

test("the CLI fails closed on a missing or empty file", () => {
  assert.equal(runWithFile(undefined).status, 1);
  assert.equal(runWithFile("").status, 1);
});
