// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
