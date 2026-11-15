// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Checks one `sha256sum`-format line against the file it names, in the same
// folder: `node scripts/verify-sha256.mjs <dir>/SHA256SUMS`. The npm publish
// job runs it on the downloaded artifact, so the tarball published is the
// one the build job tested. Exit 1 on a mismatch.
import console from "node:console";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export function parseChecksumLine(text) {
  const match = /^([0-9a-f]{64}) [ *]([^\n]+)\n?$/.exec(text);
  if (match === null) throw new Error("not a sha256sum line");
  const [, hash, name] = match;
  if (name !== basename(name)) throw new Error(`name must be a plain file name: ${name}`);
  return { hash, name };
}

export function verifyChecksumFile(sumFile) {
  const { hash, name } = parseChecksumLine(readFileSync(sumFile, "utf8"));
  let content;
  try {
    content = readFileSync(join(dirname(sumFile), name));
  } catch {
    return { ok: false, message: `${name} is missing next to ${sumFile}` };
  }
  const actual = createHash("sha256").update(content).digest("hex");
  if (actual !== hash) {
    return { ok: false, message: `SHA-256 mismatch for ${name}: expected ${hash}, got ${actual}` };
  }
  return { ok: true, message: `${name}: SHA-256 ${hash} verified` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sumFile = process.argv[2];
  if (sumFile === undefined) {
    console.error("usage: verify-sha256.mjs <SHA256SUMS file>");
    process.exit(2);
  }
  const { ok, message } = verifyChecksumFile(sumFile);
  (ok ? console.log : console.error)(message);
  process.exit(ok ? 0 : 1);
}
