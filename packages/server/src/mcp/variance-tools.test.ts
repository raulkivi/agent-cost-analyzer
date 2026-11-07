// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { costVarianceSchema, priceChangeListSchema } from "@agent-cost-analyzer/domain";
import type { ApiService } from "../services/api/api-service.js";
import { connectCostFixture } from "../test-support/cost-analysis-fixture.js";

// Phase 15 step 15.10 (plan §10.1.1–§10.1.3, §10.1.6): explain_cost_change
// and get_price_changes return what their HTTP twins return; the prompt of
// the same name chains them; list_findings takes kind "price-change".

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;
const structured = (result: ToolResult) => result.structuredContent as Record<string, unknown>;
const textOf = (result: ToolResult): string => (result.content as { text: string }[])[0]!.text;

describe("MCP variance and price-change tools (step 15.10)", () => {
  let client: Client;
  let api: ApiService;

  beforeEach(async () => {
    ({ client, api } = await connectCostFixture());
  });

  afterEach(async () => {
    await client.close();
  });

  it("lists both tools read-only with output schemas, and says the effects add up and are on the priced basis", async () => {
    const { tools } = await client.listTools();
    const explain = tools.find((tool) => tool.name === "explain_cost_change");
    const changes = tools.find((tool) => tool.name === "get_price_changes");
    for (const tool of [explain, changes]) {
      expect(tool?.annotations?.readOnlyHint).toBe(true);
      expect(tool?.outputSchema?.type).toBe("object");
    }
    expect(explain?.description).toMatch(/usage.*price.*mix/i);
    expect(explain?.description).toMatch(/add up/i);
    expect(explain?.description).toMatch(/priced/i);
    expect(Object.keys(explain?.inputSchema.properties ?? {})).toEqual(expect.arrayContaining(["groupBy", "id", "periodA", "periodB", "currency"]));
    expect(changes?.description).toMatch(/inferred/i);
    expect(Object.keys(changes?.inputSchema.properties ?? {})).toEqual(expect.arrayContaining(["since", "until", "channel", "model", "kind"]));
  });

  it("explain_cost_change returns what GET /api/cost/variance returns, for months and for a since/until pair", async () => {
    const args = { groupBy: "project", id: "portal", periodA: "2026-09", periodB: "2026-10" };
    const mcp = costVarianceSchema.parse(structured(await client.callTool({ name: "explain_cost_change", arguments: args })));
    expect(mcp).toEqual(await api.getCostVariance(args));
    const range = { ...args, periodA: { since: "2026-09-01", until: "2026-09-30" } };
    const fromRange = costVarianceSchema.parse(structured(await client.callTool({ name: "explain_cost_change", arguments: range })));
    expect(fromRange.currencies).toEqual(mcp.currencies);
  });

  it("explain_cost_change puts no local folder path in its output (§10.1.5)", async () => {
    const result = await client.callTool({ name: "explain_cost_change", arguments: { groupBy: "repository", id: "local:scratch", periodA: "2026-09", periodB: "2026-10" } });
    expect(JSON.stringify(structured(result))).not.toMatch(/\/home\//);
  });

  it("get_price_changes returns what GET /api/price-book/changes returns", async () => {
    const args = { since: "2026-10-01", until: "2026-10-31" };
    const mcp = priceChangeListSchema.parse(structured(await client.callTool({ name: "get_price_changes", arguments: args })));
    expect(mcp).toEqual(await api.getPriceChanges(args));
    expect(mcp.changes.some((change) => change.kind === "documented")).toBe(true);
  });

  it("refuses a bad period with a tool error", async () => {
    const result = await client.callTool({ name: "explain_cost_change", arguments: { groupBy: "project", id: "portal", periodA: "September", periodB: "2026-10" } });
    expect(result.isError).toBe(true);
  });

  it("offers the explain_cost_change prompt, which chains compare_costs, explain_cost_change and get_price_changes", async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((prompt) => prompt.name)).toContain("explain_cost_change");
    const prompt = await client.getPrompt({ name: "explain_cost_change", arguments: { groupBy: "project", id: "portal", periodA: "2026-09", periodB: "2026-10" } });
    const text = (prompt.messages[0]!.content as { text: string }).text;
    for (const name of ["compare_costs", "explain_cost_change", "get_price_changes"]) expect(text).toContain(name);
    expect(text).toMatch(/usage, price or mix/i);
  });

  it("list_findings takes kind price-change", async () => {
    const result = await client.callTool({ name: "list_findings", arguments: { kind: ["price-change"] } });
    expect(result.isError).not.toBe(true);
    expect(textOf(result).length).toBeGreaterThan(0);
  });
});

describe("list_findings description (step 15.10)", () => {
  it("names the price-change kind", async () => {
    const { client } = await connectCostFixture();
    const { tools } = await client.listTools();
    expect(tools.find((tool) => tool.name === "list_findings")?.description).toMatch(/price-change/);
    await client.close();
  });
});
