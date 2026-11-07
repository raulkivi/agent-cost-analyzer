// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { CostBasisTotals, CostVariance } from "@agent-cost-analyzer/domain";
import { expect, test } from "../support/app-fixture.js";
import { connectStdioMcp, structured } from "../support/mcp-stdio.js";

// Phase 15 step 15.13 (plan §10.1.6): the MCP exit criterion, over stdio, on
// the fixture home (Copilot, Claude Code and pi sessions across the portal
// and billing repositories in their projects). The extension's 17 tools and
// 4 prompts over stdio are its bundle test's (mcp-stdio-bundle.test.ts).

test("MCP exit criterion: 19 read-only tools and 6 prompts; priced beside billed; effects that add up", async ({ app }) => {
  const client = await connectStdioMcp(app.home);
  try {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(19);
    expect(tools.every((tool) => tool.annotations?.readOnlyHint === true && tool.outputSchema?.type === "object")).toBe(true);
    const { prompts } = await client.listPrompts();
    expect(prompts.map((prompt) => prompt.name).sort()).toEqual(
      ["audit_session", "estimate_work", "explain_cost_change", "prepare_statement", "review_costs", "security_review"],
    );

    // Customer portal in October: Copilot billed, Claude Code priced (with its price versions), pi reported.
    const cost = structured<{ totals: CostBasisTotals }>(
      await client.callTool({ name: "get_project_cost", arguments: { projectId: "portal", since: "2026-10-01", until: "2026-10-31" } }),
    );
    expect(cost.totals.billed.knownTurns).toBeGreaterThan(0);
    expect(cost.totals.billed.amounts.map((amount) => amount.currency)).toContain("AI_CREDITS");
    expect(cost.totals.priced.knownTurns).toBeGreaterThan(0);
    expect(cost.totals.priceVersionIds.some((id) => id.startsWith("anthropic-api:claude-sonnet-5.5:"))).toBe(true);
    expect(cost.totals.preferredBasisTurns).toMatchObject({ billed: expect.any(Number), priced: expect.any(Number), reported: expect.any(Number) });
    expect(cost.totals.preferredBasisTurns.billed).toBeGreaterThan(0);

    // Across Claude Sonnet 5.5's 2026-10-07 cache-read cut (the fixture's documented change, where the plan's sample says Sep 1).
    const variance = structured<CostVariance>(
      await client.callTool({
        name: "explain_cost_change",
        arguments: { groupBy: "project", id: "portal", periodA: { since: "2026-10-01", until: "2026-10-06" }, periodB: { since: "2026-10-07", until: "2026-10-31" } },
      }),
    );
    expect(variance.priceChanges.some((change) => change.modelId === "claude-sonnet-5.5" && change.date === "2026-10-07")).toBe(true);
    expect(variance.currencies.length).toBeGreaterThan(0);
    for (const row of variance.currencies) {
      expect(row.usage + row.price + row.mix).toBeCloseTo(row.change, 9);
      expect(row.costB - row.costA).toBeCloseTo(row.change, 9);
    }
    expect(variance.currencies.some((row) => row.price !== 0)).toBe(true);
  } finally {
    await client.close();
  }
});
