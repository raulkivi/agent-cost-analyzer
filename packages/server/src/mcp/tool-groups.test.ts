// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it } from "vitest";
import type { Client } from "@modelcontextprotocol/client";
import { connectCostFixture } from "../test-support/cost-analysis-fixture.js";
import { MCP_TOOL_GROUPS, EXTENSION_TOOL_GROUPS } from "./mcp-server.js";

// Phase 15 step 15.13 (plan §10.1.4, §10.1.6): createMcpServer's toolGroups
// option. The standalone server registers every group; the extension's
// leaves out billing (D7), so neither get_statement nor estimate_cost nor
// their prompts. A group is registered only when its services are given too.
// Phase 14 step 14.5 adds the replay group to both (D5).

const CORE_TOOLS = [
  "list_log_providers",
  "list_sessions",
  "get_turn",
  "get_session_audit",
  "list_tool_calls",
  "get_audit_rollup",
  "get_session_cost",
  "get_cost_rollup",
  "list_findings",
];
const PHASE_15_TOOLS_WITHOUT_BILLING = [
  "list_repositories",
  "list_projects",
  "get_price_book",
  "get_price_changes",
  "get_repository_cost",
  "get_project_cost",
  "compare_costs",
  "explain_cost_change",
];
// Phase 14 step 14.5 (D5, D7): the replay group, in both products.
const REPLAY_TOOLS = ["replay_session", "compare_models_for_session"];
// Phase 16 SR19: the savings group, in both products.
const SAVINGS_TOOLS = ["get_savings_report"];
const BILLING_TOOLS = ["get_statement", "estimate_cost"];
// MS9: the allowance group, standalone only.
const ALLOWANCE_TOOLS = ["get_monthly_allowance"];
const CORE_PROMPTS = ["audit_session", "review_costs", "security_review"];

const sorted = (names: string[]) => [...names].sort();

describe("createMcpServer's toolGroups (step 15.13)", () => {
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  it("registers every group by default: the 9 Phase 9.12 tools, the 10 Phase 15 ones and the 2 Phase 14 ones the Phase 16 savings one and the MS9 allowance one (23), and 6 prompts", async () => {
    ({ client } = await connectCostFixture());
    const { tools } = await client.listTools();
    const { prompts } = await client.listPrompts();

    expect(sorted(tools.map((tool) => tool.name))).toEqual(sorted([...CORE_TOOLS, ...PHASE_15_TOOLS_WITHOUT_BILLING, ...REPLAY_TOOLS, ...SAVINGS_TOOLS, ...BILLING_TOOLS, ...ALLOWANCE_TOOLS]));
    expect(tools).toHaveLength(23);
    expect(tools.every((tool) => tool.annotations?.readOnlyHint === true && tool.outputSchema?.type === "object")).toBe(true);
    expect(sorted(prompts.map((prompt) => prompt.name))).toEqual(sorted([...CORE_PROMPTS, "explain_cost_change", "prepare_statement", "estimate_work"]));
  });

  it("leaves out the billing and allowance groups' tools and prompts when they aren't listed (the extension's set: 20 tools, 4 prompts)", async () => {
    ({ client } = await connectCostFixture({ toolGroups: EXTENSION_TOOL_GROUPS }));
    const { tools } = await client.listTools();
    const { prompts } = await client.listPrompts();

    expect(sorted(tools.map((tool) => tool.name))).toEqual(sorted([...CORE_TOOLS, ...PHASE_15_TOOLS_WITHOUT_BILLING, ...REPLAY_TOOLS, ...SAVINGS_TOOLS]));
    expect(tools).toHaveLength(20);
    expect(sorted(prompts.map((prompt) => prompt.name))).toEqual(sorted([...CORE_PROMPTS, "explain_cost_change"]));
  });

  it("names every group once, and the extension's set is every group but billing and allowance", () => {
    expect(new Set(MCP_TOOL_GROUPS).size).toBe(MCP_TOOL_GROUPS.length);
    expect(sorted([...EXTENSION_TOOL_GROUPS, "billing", "allowance"])).toEqual(sorted([...MCP_TOOL_GROUPS]));
  });

  it("registers the replay group alone when only it is listed", async () => {
    ({ client } = await connectCostFixture({ toolGroups: ["replay"] }));
    const { tools } = await client.listTools();

    expect(sorted(tools.map((tool) => tool.name))).toEqual(sorted(REPLAY_TOOLS));
  });

  it("registers only the listed groups", async () => {
    ({ client } = await connectCostFixture({ toolGroups: ["sessions", "pricing"] }));
    const { tools } = await client.listTools();

    expect(sorted(tools.map((tool) => tool.name))).toEqual(sorted(["list_log_providers", "list_sessions", "get_turn", "get_price_book", "get_price_changes"]));
  });
});
