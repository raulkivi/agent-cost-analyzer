// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { connectCostFixture } from "../../test-support/cost-analysis-fixture.js";
import { resolveAppViews } from "./resolve-app-views.js";

// Phase 12 A13 (docs/plans/mcp-apps.md §4.2, §7): both entry points turn the
// built views.html path into the appViews option, or into nothing when the
// file is absent, so a checkout that never built mcp-apps still starts.

const HTML = '<!doctype html><html><head><meta name="aca-brand" content=""></head><body>built views</body></html>';
const URI = "ui://agent-cost-analyzer/views.html";

describe("resolveAppViews", () => {
  let dir: string | undefined;
  let client: Client | undefined;
  afterEach(async () => {
    await client?.close();
    client = undefined;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  const tmpFile = (content: string) => {
    dir = mkdtempSync(path.join(tmpdir(), "app-views-"));
    const file = path.join(dir, "views.html");
    writeFileSync(file, content);
    return file;
  };

  it("gives no appViews without a path", () => {
    expect(resolveAppViews(undefined)).toEqual({});
  });

  it("gives no appViews when the file does not exist, and reports it through onMissing", () => {
    const missing: string[] = [];
    expect(resolveAppViews("/nonexistent/views.html", (p) => missing.push(p))).toEqual({});
    expect(missing).toEqual(["/nonexistent/views.html"]);
  });

  it("serves the built file as the views resource and puts _meta.ui on the three tools", async () => {
    const options = resolveAppViews(tmpFile(HTML));
    ({ client } = await connectCostFixture(options));

    const { tools } = await client.listTools();
    for (const name of ["get_session_cost", "get_cost_rollup", "list_findings"]) {
      expect(tools.find((tool) => tool.name === name)!._meta).toMatchObject({ ui: { resourceUri: URI } });
    }
    const { contents } = await client.readResource({ uri: URI });
    expect(contents[0]).toMatchObject({ uri: URI, mimeType: RESOURCE_MIME_TYPE });
    expect(RESOURCE_MIME_TYPE).toBe("text/html;profile=mcp-app");
    expect((contents[0] as { text: string }).text).toContain("built views");
  });

  it("still starts and lists the 21 normal tools when the file is missing", async () => {
    ({ client } = await connectCostFixture(resolveAppViews("/nonexistent/views.html", () => undefined)));

    const { tools } = await client.listTools();
    expect(tools).toHaveLength(21);
    expect(tools.some((tool) => tool._meta !== undefined)).toBe(false);
    expect(client.getServerCapabilities()?.resources).toBeUndefined();
  });
});
