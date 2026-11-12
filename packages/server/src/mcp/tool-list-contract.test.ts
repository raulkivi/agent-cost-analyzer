// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { connectCostFixture } from "../test-support/cost-analysis-fixture.js";
import { readMcpSurface, surfaceFixture, type McpSurfaceClient } from "../test-support/mcp-surface.js";
import { InMemoryViewSource } from "./apps/view-source.js";

// docs/plans/mcp-sdk-2-migration.md M2: what a host reads of the standalone
// server (tools with annotations, _meta.ui and output schemas, instructions,
// capabilities, the views resource, prompts), pinned by a snapshot taken on
// SDK 1.32.2 and ext-apps 1.7.5. A change of SDK must leave it as it is;
// only the JSON Schema dialect of the advertised schemas may change, which
// readMcpSurface normalises and mcp-schema-dialect.test.ts asserts.

const appViews = { source: new InMemoryViewSource('<!doctype html><html><head><meta name="aca-brand" content=""></head><body>views</body></html>') };

async function surfaceOf(options: Parameters<typeof connectCostFixture>[0] = {}) {
  const { client } = await connectCostFixture(options);
  try {
    return await readMcpSurface(client as Client as unknown as McpSurfaceClient);
  } finally {
    await client.close();
  }
}

describe("the standalone MCP server's tool list (SDK 2 migration contract)", () => {
  it("lists the same 21 tools without views and 22 with them, with the same metadata, resource and prompts as on SDK 1", async () => {
    const withoutViews = await surfaceOf();
    const withViews = await surfaceOf({ appViews });

    expect(withoutViews.tools).toHaveLength(21);
    expect(withViews.tools).toHaveLength(22);
    await expect(surfaceFixture({ withoutViews, withViews })).toMatchFileSnapshot("./__snapshots__/tool-list-standalone.json");
  });
});
