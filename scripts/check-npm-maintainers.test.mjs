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
