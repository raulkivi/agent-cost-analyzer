// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { costEstimateSchema, statementAnswerSchema } from "@agent-cost-analyzer/domain";
import type { ApiService } from "../services/api/api-service.js";
import { connectCostFixture } from "../test-support/cost-analysis-fixture.js";

// Phase 15 step 15.11 (plan §10.1.1, §10.1.3, §10.1.6): get_statement returns
// what GET /api/statements returns and never issues one; prepare_statement
// chains it.

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;
const structured = (result: ToolResult) => result.structuredContent as Record<string, unknown>;

describe("MCP billing tools (step 15.11)", () => {
  let client: Client;
  let api: ApiService;

  beforeEach(async () => {
    ({ client, api } = await connectCostFixture());
  });

  afterEach(async () => {
    await client.close();
  });

  it("lists get_statement read-only with its output schema, saying it never issues", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((candidate) => candidate.name === "get_statement");
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    expect(tool?.outputSchema?.type).toBe("object");
    expect(tool?.description).toMatch(/never issues/i);
    expect(Object.keys(tool?.inputSchema.properties ?? {})).toEqual(expect.arrayContaining(["projectId", "period", "includeLines"]));
    expect(tools.some((candidate) => /issue/.test(candidate.name))).toBe(false);
  });

  it("returns what GET /api/statements returns", async () => {
    const mcp = statementAnswerSchema.parse(structured(await client.callTool({ name: "get_statement", arguments: { projectId: "portal", period: "2026-10" } })));
    expect(mcp).toEqual(await api.getStatement({ projectId: "portal", period: "2026-10" }));
  });

  it("leaves the lines out when asked, keeping totals and unknown lines", async () => {
    const mcp = statementAnswerSchema.parse(structured(await client.callTool({ name: "get_statement", arguments: { projectId: "portal", period: "2026-10", includeLines: false } })));
    expect(mcp.statement.lines).toEqual([]);
    expect(mcp.statement.totals.length).toBeGreaterThan(0);
  });

  it("answers an unknown project or bad period with a tool error", async () => {
    expect((await client.callTool({ name: "get_statement", arguments: { projectId: "nope", period: "2026-10" } })).isError).toBe(true);
    expect((await client.callTool({ name: "get_statement", arguments: { projectId: "portal", period: "October" } })).isError).toBe(true);
  });

  it("offers prepare_statement, which calls get_statement and says issuing is done in the app", async () => {
    const prompt = await client.getPrompt({ name: "prepare_statement", arguments: { projectId: "portal", period: "2026-10" } });
    const text = (prompt.messages[0]!.content as { text: string }).text;
    expect(text).toContain("get_statement");
    expect(text).toMatch(/issu\w+ .*in the app/i);
    expect(text).toMatch(/unknown/i);
  });

  // Step 15.12 (plan §10.1.1, §10.1.3): estimate_cost and estimate_work.
  it("estimate_cost returns what GET /api/estimates returns: a labelled range or the reason, never one number", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((candidate) => candidate.name === "estimate_cost");
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    expect(tool?.description).toMatch(/never a single number/i);
    const args = { projectId: "portal", activeDays: 20 };
    const mcp = costEstimateSchema.parse(structured(await client.callTool({ name: "estimate_cost", arguments: args })));
    expect(mcp).toEqual(await api.getCostEstimate({ projectId: "portal", activeDays: "20" }));
    expect(mcp.label).toBe("estimate");
    expect((await client.callTool({ name: "estimate_cost", arguments: { projectId: "nope", activeDays: 20 } })).isError).toBe(true);
    expect((await client.callTool({ name: "estimate_cost", arguments: { projectId: "portal" } })).isError).toBe(true);
  });

  it("offers estimate_work, which chains estimate_cost and get_project_cost and names the uncertainty", async () => {
    const prompt = await client.getPrompt({ name: "estimate_work", arguments: { projectId: "portal", activeDays: "20" } });
    const text = (prompt.messages[0]!.content as { text: string }).text;
    for (const name of ["estimate_cost", "get_project_cost"]) expect(text).toContain(name);
    expect(text).toMatch(/range/);
    expect(text).toMatch(/uncertain/i);
  });
});
