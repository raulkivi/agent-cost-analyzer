// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Refuses to publish unless the owner is the package's only npm maintainer:
// `npm view agent-cost-analyzer maintainers --json | node
// scripts/check-npm-maintainers.mjs raulkivi`. Fails closed on any output it
// can't read, so a registry error never lets a publish through.
import console from "node:console";
import { readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

function nameOf(entry) {
  if (typeof entry === "string") return entry.replace(/\s*<.*>\s*$/, "").trim();
  if (entry !== null && typeof entry === "object" && typeof entry.name === "string") return entry.name;
  return "";
}

export function checkMaintainers(json, owner) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, message: "maintainers output is not JSON" };
  }
  const names = (Array.isArray(parsed) ? parsed : [parsed]).map(nameOf);
  if (names.length === 0 || names.some((name) => name === "")) {
    return { ok: false, message: "no readable maintainers" };
  }
  if (names.length !== 1 || names[0] !== owner) {
    return { ok: false, message: `maintainers must be only ${owner}, got: ${names.join(", ")}` };
  }
  return { ok: true, message: `maintainer is ${owner} only` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const owner = process.argv[2];
  if (owner === undefined) {
    console.error("usage: check-npm-maintainers.mjs <owner> < maintainers.json");
    process.exit(2);
  }
  const { ok, message } = checkMaintainers(readFileSync(0, "utf8"), owner);
  (ok ? console.log : console.error)(message);
  process.exit(ok ? 0 : 1);
}
