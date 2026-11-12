// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import {
  initializeLegacy,
  MODERN_PROTOCOL_VERSION,
  modernEnvelope,
  spawnJsonRpcStdio,
  type JsonRpcStdioPeer,
} from "@agent-cost-analyzer/server/src/test-support/json-rpc-stdio";
import { mcpServerBundleOptions } from "../../scripts/esbuild-options.mts";

const serverFixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../server/fixtures");
const VIEWS_URI = "ui://ai-credits-analyzer/views.html";

// docs/plans/mcp-sdk-2-migration.md D1: the built child process
// (dist/mcp-stdio.js) serves 2025-era clients (an `initialize` at
// 2025-06-18 or 2025-11-25, what VS Code sends today) and 2026-07-28 ones
// (`server/discover`, then requests carrying the `_meta` envelope); D4: the
// views resource answers a 2026-07-28 read with `ttlMs: 0`.
describe("the built MCP server bundle's protocol revisions (MCP SDK 2, D1, D4)", () => {
  let installDir: string;
  let bundle: string;
  let userDataDir: string;
  const peers: JsonRpcStdioPeer[] = [];

  beforeAll(async () => {
    installDir = mkdtempSync(path.join(tmpdir(), "ai-credits-analyzer-mcp-revisions-"));
    await build({ ...mcpServerBundleOptions(path.join(installDir, "dist")), logLevel: "silent" });
    writeFileSync(path.join(installDir, "package.json"), JSON.stringify({ name: "ai-credits-analyzer", version: "9.9.9-test" }));
    bundle = path.join(installDir, "dist", "mcp-stdio.js");
    for (const name of ["vendor-profiles", "price-book"]) {
      cpSync(path.join(serverFixturesDir, name), path.join(installDir, "media", name), { recursive: true });
    }
    mkdirSync(path.join(installDir, "dist", "mcp-apps"), { recursive: true });
    writeFileSync(path.join(installDir, "dist", "mcp-apps", "views.html"), '<!doctype html><html><head><meta name="aca-brand" content=""></head><body>built views</body></html>');
    userDataDir = path.join(installDir, "user-data");
    mkdirSync(path.join(userDataDir, "User"), { recursive: true });
  }, 60_000);

  afterAll(async () => {
    await Promise.all(peers.map((peer) => peer.close()));
    rmSync(installDir, { recursive: true, force: true });
  });

  function start(): JsonRpcStdioPeer {
    const peer = spawnJsonRpcStdio(process.execPath, [bundle, "--user-data-dir", userDataDir], { PATH: process.env.PATH ?? "", HOME: installDir });
    peers.push(peer);
    return peer;
  }

  it.each(["2025-06-18", "2025-11-25"])("answers a 2025-era initialize at %s with that version and lists its 20 tools", async (protocolVersion) => {
    const peer = start();

    const initialized = await initializeLegacy(peer, protocolVersion);
    const listed = await peer.request("tools/list");

    expect(initialized.result).toMatchObject({ protocolVersion, serverInfo: { name: "ai-credits-analyzer", version: "9.9.9-test" } });
    expect((listed.result?.tools as unknown[]).length).toBe(20);
  }, 60_000);

  it("answers server/discover with 2026-07-28 and serves 2026-07-28 requests on the same connection", async () => {
    const peer = start();

    const discovered = await peer.request("server/discover", { _meta: modernEnvelope() });
    const listed = await peer.request("tools/list", { _meta: modernEnvelope() });

    expect(discovered.error).toBeUndefined();
    expect(discovered.result?.supportedVersions).toContain(MODERN_PROTOCOL_VERSION);
    expect((listed.result?.tools as unknown[]).length).toBe(20);
  }, 60_000);

  it("answers a 2026-07-28 read of the views resource with ttlMs 0", async () => {
    const peer = start();

    const read = await peer.request("resources/read", { uri: VIEWS_URI, _meta: modernEnvelope() });

    expect(read.error).toBeUndefined();
    expect(read.result).toMatchObject({ ttlMs: 0, contents: [{ uri: VIEWS_URI, mimeType: "text/html;profile=mcp-app" }] });
  }, 60_000);
});
