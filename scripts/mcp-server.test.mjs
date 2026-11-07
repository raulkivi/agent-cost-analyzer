// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

// Phase 12 A13: scripts/mcp-server.sh passes --app-views-html with the built
// packages/mcp-apps/dist/views.html when it exists. The test lays out a
// stand-in checkout whose tsx just prints its arguments.
const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "mcp-server.sh");
const roots = [];
after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

function checkout({ built }) {
  const root = mkdtempSync(path.join(tmpdir(), "mcp-server-sh-"));
  roots.push(root);
  mkdirSync(path.join(root, "scripts"));
  copyFileSync(script, path.join(root, "scripts", "mcp-server.sh"));
  mkdirSync(path.join(root, "node_modules", ".bin"), { recursive: true });
  const tsx = path.join(root, "node_modules", ".bin", "tsx");
  writeFileSync(tsx, '#!/usr/bin/env bash\nprintf "%s\\n" "$@"\n');
  chmodSync(tsx, 0o755);
  if (built) {
    mkdirSync(path.join(root, "packages", "mcp-apps", "dist"), { recursive: true });
    writeFileSync(path.join(root, "packages", "mcp-apps", "dist", "views.html"), "<html></html>");
  }
  return root;
}

const argsOf = (root, ...extra) =>
  execFileSync("bash", [path.join(root, "scripts", "mcp-server.sh"), ...extra], { encoding: "utf8" }).trim().split("\n");

test("passes --app-views-html with the built views file when it exists", () => {
  const root = checkout({ built: true });
  assert.deepEqual(argsOf(root, "--project-billing-details"), [
    path.join(root, "packages", "server", "src", "mcp", "stdio.ts"),
    "--app-views-html",
    path.join(root, "packages", "mcp-apps", "dist", "views.html"),
    "--project-billing-details",
  ]);
});

test("passes no views flag when mcp-apps was not built", () => {
  const root = checkout({ built: false });
  assert.deepEqual(argsOf(root), [path.join(root, "packages", "server", "src", "mcp", "stdio.ts")]);
});
