// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { turnSeriesSchema } from "@agent-cost-analyzer/domain";
import { COPILOT_MCP_IDENTITY } from "../../composition/create-copilot-mcp-services.js";
import { connectCostFixture } from "../../test-support/cost-analysis-fixture.js";
import { STANDALONE_MCP_IDENTITY } from "../mcp-identity.js";
import { MCP_TOOL_GROUPS, WITHOUT_BILLING_TOOL_GROUPS } from "../mcp-server.js";
import { injectBrand } from "./inject-brand.js";
import { toViewBrand } from "./view-brand.js";
import { InMemoryViewSource } from "./view-source.js";

// Phase 12 A8 (docs/plans/mcp-apps.md §4.2): the views resource, the
// app-only get_turn_series tool and _meta.ui on three tools.

const HTML = '<!doctype html><html><head><meta name="aca-brand" content=""></head><body>views</body></html>';
const appViews = { source: new InMemoryViewSource(HTML) };
const VIEW_TOOLS = ["get_session_cost", "get_cost_rollup", "list_findings"];
const URI = "ui://agent-cost-analyzer/views.html";

type Tools = Awaited<ReturnType<Client["listTools"]>>["tools"];
const byName = (tools: Tools, name: string) => tools.find((tool) => tool.name === name);
const textOf = (result: object) => ((result as { content: unknown }).content as { text: string }[])[0]!.text;

describe("registerAppViews", () => {
  let client: Client | undefined;
  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  it("changes nothing without appViews: no resource, no _meta, no get_turn_series (21 tools)", async () => {
    ({ client } = await connectCostFixture());
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(21);
    expect(byName(tools, "get_turn_series")).toBeUndefined();
    expect(tools.some((tool) => tool._meta !== undefined)).toBe(false);
    expect(client.getServerCapabilities()?.resources).toBeUndefined();
  });

  it("with appViews, adds only get_turn_series and _meta.ui on exactly the three tools (22 standalone)", async () => {
    const plain = await connectCostFixture();
    const withViews = await connectCostFixture({ appViews });
    client = withViews.client;
    const before = (await plain.client.listTools()).tools;
    const after = (await client.listTools()).tools;
    await plain.client.close();

    expect(after).toHaveLength(22);
    const strip = (tool: Tools[number]) => ({ ...tool, _meta: undefined });
    expect(after.filter((tool) => tool.name !== "get_turn_series").map(strip)).toEqual(before.map(strip));
    expect(
      after
        .filter((tool) => tool._meta !== undefined)
        .map((tool) => tool.name)
        .sort(),
    ).toEqual([...VIEW_TOOLS, "get_turn_series"].sort());
    for (const name of VIEW_TOOLS) {
      expect(byName(after, name)!._meta).toEqual({ ui: { resourceUri: URI }, "ui/resourceUri": URI });
    }
    expect(byName(after, "get_turn_series")!._meta).toEqual({ ui: { visibility: ["app"] } });
    expect(byName(after, "get_turn_series")!.annotations?.readOnlyHint).toBe(true);
  });

  it("has 20 tools with the extension's groups", async () => {
    ({ client } = await connectCostFixture({ appViews, toolGroups: WITHOUT_BILLING_TOOL_GROUPS }));
    expect((await client.listTools()).tools).toHaveLength(20);
  });

  it("leaves the three tools' results unchanged", async () => {
    const plain = await connectCostFixture();
    const withViews = await connectCostFixture({ appViews });
    client = withViews.client;
    const calls: [string, Record<string, unknown>][] = [
      ["get_session_cost", { sessionId: "cp-1" }],
      ["get_cost_rollup", {}],
      ["list_findings", {}],
    ];
    for (const [name, args] of calls) {
      const a = await plain.client.callTool({ name, arguments: args });
      const b = await client.callTool({ name, arguments: args });
      expect(b).toEqual(a);
    }
    await plain.client.close();
  });

  it("gives no _meta.ui to a tool whose group is off", async () => {
    ({ client } = await connectCostFixture({ appViews, toolGroups: MCP_TOOL_GROUPS.filter((group) => group !== "findings") }));
    const { tools } = await client.listTools();
    expect(byName(tools, "list_findings")).toBeUndefined();
    expect(byName(tools, "get_session_cost")!._meta?.ui).toEqual({ resourceUri: URI });

    const cost = await connectCostFixture({ appViews, toolGroups: ["sessions", "audit"] });
    const onlyOtherGroups = (await cost.client.listTools()).tools;
    await cost.client.close();
    expect(onlyOtherGroups.filter((tool) => (tool._meta?.ui as { resourceUri?: string } | undefined)?.resourceUri !== undefined)).toEqual([]);
  });

  it.each([
    ["standalone", STANDALONE_MCP_IDENTITY, "ui://agent-cost-analyzer/views.html"],
    ["extension", COPILOT_MCP_IDENTITY, "ui://ai-credits-analyzer/views.html"],
  ])("serves the %s resource with the MCP Apps MIME type and the injected brand", async (_label, identity, uri) => {
    ({ client } = await connectCostFixture({ appViews, identity }));
    const { resources } = await client.listResources();
    expect(resources.map((resource) => resource.uri)).toEqual([uri]);
    const { contents } = await client.readResource({ uri });
    expect(contents).toHaveLength(1);
    expect(contents[0]!.mimeType).toBe("text/html;profile=mcp-app");
    expect(contents[0]!.uri).toBe(uri);
    const text = (contents[0] as { text: string }).text;
    expect(text).toBe(injectBrand(HTML, toViewBrand(identity, "0.0.0-test")));
    expect(text.includes("deepLinkBase")).toBe(identity.deepLinkBase !== undefined);
    const tools = (await client.listTools()).tools;
    expect(byName(tools, "get_session_cost")!._meta?.ui).toEqual({ resourceUri: uri });
  });

  // A14 security review (docs/plans/mcp-apps.md §6): the resource keeps the
  // host's default CSP (no connect or resource domains, no frames) and asks
  // for no sandbox origin, in the listing and in the read result.
  it("declares no CSP domains, no sandbox domain and keeps the host's border", async () => {
    ({ client } = await connectCostFixture({ appViews }));
    const { resources } = await client.listResources();
    const { contents } = await client.readResource({ uri: URI });
    for (const meta of [resources[0]!._meta, contents[0]!._meta]) {
      const ui = (meta?.ui ?? {}) as Record<string, unknown>;
      expect(ui.csp).toBeUndefined();
      expect(ui.domain).toBeUndefined();
      expect(ui.permissions).toBeUndefined();
      expect(ui.prefersBorder).not.toBe(false);
      expect(JSON.stringify(meta ?? {})).not.toMatch(/connectDomains|resourceDomains|frameDomains|baseUriDomains/);
    }
  });

  describe("get_turn_series", () => {
    it("returns a schema-valid series", async () => {
      ({ client } = await connectCostFixture({ appViews }));
      const result = await client.callTool({ name: "get_turn_series", arguments: { sessionId: "cp-1" } });
      expect(result.isError).toBeFalsy();
      const series = turnSeriesSchema.parse(result.structuredContent);
      expect(series.sessionId).toBe("cp-1");
      expect(series.turns).toHaveLength(2);
      expect(series.truncated).toBe(false);
      expect(JSON.parse(textOf(result))).toEqual(series);
    });

    it("clamps maxTurns", async () => {
      ({ client } = await connectCostFixture({ appViews }));
      const one = turnSeriesSchema.parse((await client.callTool({ name: "get_turn_series", arguments: { sessionId: "cp-1", maxTurns: 1 } })).structuredContent);
      expect(one.turns).toHaveLength(1);
      expect(one.truncated).toBe(true);
      expect(one.totalTurns).toBe(2);
      const tooMany = await client.callTool({ name: "get_turn_series", arguments: { sessionId: "cp-1", maxTurns: 5000 } });
      expect(tooMany.isError).toBe(true); // above the input schema's max of 2000
    });

    it("reads the named provider", async () => {
      ({ client } = await connectCostFixture({ appViews }));
      const result = await client.callTool({ name: "get_turn_series", arguments: { sessionId: "cc-1", provider: "claude-code" } });
      expect(turnSeriesSchema.parse(result.structuredContent).sessionId).toBe("cc-1");
    });

    it("errors cleanly on an unknown session and an unknown provider", async () => {
      ({ client } = await connectCostFixture({ appViews }));
      const unknown = await client.callTool({ name: "get_turn_series", arguments: { sessionId: "nope" } });
      expect(unknown.isError).toBe(true);
      expect(textOf(unknown)).toMatch(/Unknown session id "nope"/);
      const badProvider = await client.callTool({ name: "get_turn_series", arguments: { sessionId: "cp-1", provider: "zzz" } });
      expect(badProvider.isError).toBe(true);
      expect(textOf(badProvider)).toMatch(/Known providers/);
    });
  });
});
