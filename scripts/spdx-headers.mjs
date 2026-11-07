// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Adds or checks SPDX copyright headers: `node scripts/spdx-headers.mjs --check|--fix`.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import console from "node:console";
import { extname } from "node:path";
import process from "node:process";

const LINES = [
  "SPDX-FileCopyrightText: 2026 Raul Kivi",
  "SPDX-License-Identifier: MIT",
];
const EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".css",
  ".sh",
]);
// Third-party or generated trees keep their own notices.
const EXCLUDED = [
  "ds-bundle/",
  ".ds-sync/",
  ".design-sync/",
  "Design/",
  "node_modules/",
  "/fixtures/",
  "/dist/",
];

export const isHeaderTarget = (path) =>
  EXTENSIONS.has(extname(path)) &&
  !EXCLUDED.some((part) =>
    `/${path}`.includes(part.startsWith("/") ? part : `/${part}`),
  );

export const hasHeader = (text) =>
  text.slice(0, 400).includes("SPDX-FileCopyrightText:");

const render = (ext) =>
  ext === ".css"
    ? `/* ${LINES[0]}\n   ${LINES[1]}\n*/\n`
    : LINES.map((l) => `${ext === ".sh" ? "#" : "//"} ${l}\n`).join("");

export const addHeader = (path, text) => {
  if (hasHeader(text)) return text;
  const header = render(extname(path));
  if (text.startsWith("#!")) {
    const end = text.indexOf("\n") + 1;
    return text.slice(0, end) + header + text.slice(end);
  }
  return header + text;
};

const main = () => {
  const mode = process.argv[2];
  if (mode !== "--check" && mode !== "--fix") {
    console.error("usage: spdx-headers.mjs --check|--fix");
    process.exit(2);
  }
  const files = execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter(isHeaderTarget);
  const missing = files.filter((f) => !hasHeader(readFileSync(f, "utf8")));
  if (mode === "--fix") {
    for (const f of missing)
      writeFileSync(f, addHeader(f, readFileSync(f, "utf8")));
    console.log(`added headers to ${missing.length} files`);
  } else if (missing.length > 0) {
    console.error(`missing SPDX header:\n${missing.join("\n")}`);
    process.exit(1);
  }
};

if (import.meta.url === `file://${process.argv[1]}`) main();
