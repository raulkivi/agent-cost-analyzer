// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Phase 17 (dense-ledger-ui.md D1, L4): the ledger's light/dark switch is the
// standalone app's. The MCP views follow the host's own theme (html[data-theme]
// and the host's variables), so nothing here may set or read html[data-color-mode],
// or the ledger rules in the shared theme.css could reach them.
const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(full) : [full];
  });
}

describe("MCP Apps views and the standalone colour mode", () => {
  it("never set, read or style data-color-mode", () => {
    const offenders = sourceFiles(srcDir).filter((file) => /data-color-mode|dataset\.colorMode|use-?color-?mode/i.test(readFileSync(file, "utf-8")));
    expect(offenders.map((file) => path.relative(srcDir, file))).toEqual([]);
  });
});
