// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Phase 12 A13: `npm run build` runs the workspaces in this order, and the
// views bundle (packages/mcp-apps/dist/views.html) is what the server and
// the extension serve, so mcp-apps comes before both.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => JSON.parse(readFileSync(path.join(root, file), "utf8"));

test("builds packages/mcp-apps before the server and the extension", () => {
  const { workspaces } = read("package.json");
  const at = (name) => workspaces.indexOf(`packages/${name}`);
  assert.ok(at("mcp-apps") >= 0);
  assert.ok(at("mcp-apps") < at("server"), "mcp-apps before server");
  assert.ok(at("mcp-apps") < at("vscode-extension"), "mcp-apps before vscode-extension");
});

test("the extension's own build builds mcp-apps first, so building it alone still packages the views", () => {
  const { scripts } = read("packages/vscode-extension/package.json");
  assert.match(scripts.build, /^npm run build --prefix \.\.\/mcp-apps && /);
});
