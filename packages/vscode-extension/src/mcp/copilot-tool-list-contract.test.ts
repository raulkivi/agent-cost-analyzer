// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readMcpSurface, surfaceFixture, type McpSurfaceClient } from "@agent-cost-analyzer/server/src/test-support/mcp-surface";
import { FIXTURE_VENDOR_PROFILES_DIR } from "@agent-cost-analyzer/server/src/test-support/vendor-profiles-dir";
import { createCopilotMcpServer } from "./copilot-mcp-server.js";

// docs/plans/mcp-sdk-2-migration.md M2: what a host reads of the
// extension's MCP child (tools with annotations, _meta.ui and output
// schemas, instructions, capabilities, the views resource, prompts), pinned
// by a snapshot taken on SDK 1.32.2 and ext-apps 1.7.5. Only the JSON
// Schema dialect may change; readMcpSurface normalises it.
describe("the extension's MCP server tool list (SDK 2 migration contract)", () => {
  let dir: string;
  let userDataDir: string;
  let viewsHtml: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "copilot-tool-list-contract-"));
    userDataDir = path.join(dir, "user-data");
    mkdirSync(path.join(userDataDir, "User"), { recursive: true });
    viewsHtml = path.join(dir, "views.html");
    writeFileSync(viewsHtml, '<!doctype html><html><head><meta name="aca-brand" content=""></head><body>built views</body></html>');
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function surfaceOf(appViewsHtml: string | undefined) {
    const server = createCopilotMcpServer({ userDataDir, version: "0.1.0-test", vendorProfilesDir: FIXTURE_VENDOR_PROFILES_DIR, appViewsHtml });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      return await readMcpSurface(client as unknown as McpSurfaceClient);
    } finally {
      await client.close();
    }
  }

  it("lists the same 19 tools without views and 20 with them, with the same metadata, resource and prompts as on SDK 1", async () => {
    const withoutViews = await surfaceOf(undefined);
    const withViews = await surfaceOf(viewsHtml);

    expect(withoutViews.tools).toHaveLength(19);
    expect(withViews.tools).toHaveLength(20);
    await expect(surfaceFixture({ withoutViews, withViews })).toMatchFileSnapshot("./__snapshots__/tool-list-extension.json");
  });
});
