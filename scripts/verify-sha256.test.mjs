// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { parseChecksumLine, verifyChecksumFile } from "./verify-sha256.mjs";

const sha = (text) => createHash("sha256").update(text).digest("hex");

function fixture(content, line) {
  const dir = mkdtempSync(join(tmpdir(), "sha-"));
  writeFileSync(join(dir, "pkg.tgz"), content);
  const sumFile = join(dir, "pkg.tgz.sha256");
  writeFileSync(sumFile, line);
  return sumFile;
}

test("parses sha256sum output, text and binary mode", () => {
  const hash = "a".repeat(64);
  assert.deepEqual(parseChecksumLine(`${hash}  pkg.tgz\n`), { hash, name: "pkg.tgz" });
  assert.deepEqual(parseChecksumLine(`${hash} *pkg.tgz`), { hash, name: "pkg.tgz" });
});

test("rejects a malformed line and a path outside the folder", () => {
  assert.throws(() => parseChecksumLine("nonsense"));
  assert.throws(() => parseChecksumLine(`${"a".repeat(64)}  ../x.tgz`));
});

test("passes when the file matches", () => {
  const file = fixture("tarball", `${sha("tarball")}  pkg.tgz\n`);
  assert.equal(verifyChecksumFile(file).ok, true);
});

test("fails when the file was changed", () => {
  const file = fixture("tampered", `${sha("tarball")}  pkg.tgz\n`);
  const result = verifyChecksumFile(file);
  assert.equal(result.ok, false);
  assert.match(result.message, /mismatch/i);
});

test("fails when the listed file is missing", () => {
  const file = fixture("x", `${sha("x")}  other.tgz\n`);
  assert.equal(verifyChecksumFile(file).ok, false);
});

test("checks every line of a file that lists several tarballs", () => {
  const file = fixture("tarball", "");
  writeFileSync(join(dirname(file), "two.tgz"), "second");
  const lines = (second) => `${sha("tarball")}  pkg.tgz\n${sha(second)}  two.tgz\n`;
  writeFileSync(file, lines("second"));
  const good = verifyChecksumFile(file);
  assert.equal(good.ok, true);
  assert.match(good.message, /pkg\.tgz.*\n.*two\.tgz/);
  writeFileSync(file, lines("other"));
  const bad = verifyChecksumFile(file);
  assert.equal(bad.ok, false);
  assert.match(bad.message, /two\.tgz/);
});

test("fails on an empty checksum file", () => {
  assert.equal(verifyChecksumFile(fixture("x", "")).ok, false);
});
