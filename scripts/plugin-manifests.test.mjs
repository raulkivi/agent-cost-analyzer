// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Guards the Claude Code plugin and its repository marketplace (MC16, D8/D9):
// the plugin's MCP launch spec must be the one `mcp install` writes, so the
// plugin and the other clients start the same server.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildLaunchSpec, MCP_SERVER_NAME } from "../packages/server/src/mcp/client-setup/launch-spec.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (rel) => JSON.parse(readFileSync(path.join(root, rel), "utf8"));

const pluginDir = "plugins/agent-cost-analyzer";
const manifest = readJson(`${pluginDir}/.claude-plugin/plugin.json`);
const mcp = readJson(`${pluginDir}/.mcp.json`);
const marketplace = readJson(".claude-plugin/marketplace.json");

test("plugin.json names the plugin and carries the metadata", () => {
  assert.equal(manifest.name, "agent-cost-analyzer");
  assert.match(manifest.description, /\S/);
  assert.equal(manifest.author.name, "Raul Kivi");
  assert.equal(manifest.homepage, "https://github.com/raulkivi/agent-cost-analyzer");
  assert.equal(manifest.license, "MIT");
});

test("plugin name avoids Anthropic's reserved prefixes", () => {
  assert.doesNotMatch(manifest.name, /^(claude-|anthropic-)/);
});

test(".mcp.json registers the server under MCP_SERVER_NAME with the client-setup launch spec", () => {
  const expected = buildLaunchSpec({
    version: "0.0.0",
    pin: false,
    projectBillingDetails: false,
    platform: "linux",
    windowsCmdWrap: false,
  });
  assert.deepEqual(Object.keys(mcp.mcpServers), [MCP_SERVER_NAME]);
  const server = mcp.mcpServers[MCP_SERVER_NAME];
  assert.equal(server.command, expected.command);
  assert.deepEqual(server.args, [...expected.args]);
});

test("marketplace.json has an owner and one plugin whose source exists and matches plugin.json", () => {
  assert.equal(marketplace.name, "agent-cost-analyzer");
  assert.equal(marketplace.owner.name, "Raul Kivi");
  assert.equal(marketplace.plugins.length, 1);
  const entry = marketplace.plugins[0];
  assert.equal(entry.name, manifest.name);
  assert.match(entry.description, /\S/);
  assert.ok(existsSync(path.join(root, entry.source)), `missing source ${entry.source}`);
  assert.equal(path.normalize(entry.source), path.normalize(pluginDir));
});
