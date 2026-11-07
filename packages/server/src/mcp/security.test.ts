import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { connectCostFixture, fixtureProjects } from "../test-support/cost-analysis-fixture.js";

// Phase 15 step 15.13 (plan §10.1.5, §10.1.6): tool output enters a hosted
// model's context, so across every tool of the standalone server, over the
// cost fixture moved to a generated home folder with a credential in a
// remote URL: no output carries the credential or a local path (only
// list_repositories with includePaths does), client names and billing
// codes come only from list_projects and get_statement, and no tool writes.

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;

// Every tool, with arguments that give an answer over the fixture.
const CALLS: [name: string, args: Record<string, unknown>][] = [
  ["list_log_providers", {}],
  ["list_sessions", {}],
  ["get_turn", { sessionId: "cc-1", turnIndex: 0, provider: "claude-code" }],
  ["get_session_audit", { sessionId: "cc-1", provider: "claude-code" }],
  ["list_tool_calls", { sessionId: "cc-1", provider: "claude-code" }],
  ["get_audit_rollup", { provider: "claude-code" }],
  ["get_session_cost", { sessionId: "cc-1", provider: "claude-code" }],
  ["get_cost_rollup", {}],
  ["list_findings", {}],
  ["list_repositories", {}],
  ["list_projects", {}],
  ["get_price_book", {}],
  ["get_price_changes", {}],
  ["get_repository_cost", { repository: "github.com/acme/portal-api" }],
  ["get_project_cost", { projectId: "portal" }],
  ["compare_costs", { groupBy: "repository", ids: ["github.com/acme/portal-api", "local:scratch", "path:notes"], since: "2026-10-01", until: "2026-10-31" }],
  ["explain_cost_change", { groupBy: "project", id: "portal", periodA: "2026-09", periodB: "2026-10" }],
  ["get_statement", { projectId: "portal", period: "2026-10" }],
  ["estimate_cost", { projectId: "portal", activeDays: 20 }],
];
const NAMED_CLIENT_TOOLS = ["list_projects", "get_statement"];

const CLIENT = "Acme Corp";
const BILLING_CODE = "AC-7731";
const withBillingCode = {
  ...fixtureProjects,
  projects: fixtureProjects.projects.map((project) => (project.id === "portal" ? { ...project, billingCode: BILLING_CODE } : project)),
};

async function callEvery(client: Client): Promise<Map<string, ToolResult>> {
  const results = new Map<string, ToolResult>();
  for (const [name, args] of CALLS) results.set(name, await client.callTool({ name, arguments: args }));
  return results;
}

describe("MCP security across every tool (step 15.13, plan §10.1.5)", () => {
  it("calls every tool the standalone server lists, each read-only, and each answers", async () => {
    const { client } = await connectCostFixture();
    try {
      const { tools } = await client.listTools();
      expect(CALLS.map(([name]) => name).sort()).toEqual(tools.map((tool) => tool.name).sort());
      expect(tools.every((tool) => tool.annotations?.readOnlyHint === true && tool.annotations?.destructiveHint !== true)).toBe(true);
      for (const [name, result] of await callEvery(client)) expect(result.isError, `${name}: ${JSON.stringify(result.content)}`).not.toBe(true);
    } finally {
      await client.close();
    }
  });

  it("never returns a remote's credential or a local folder path, for any home folder or secret (property)", async () => {
    await fc.assert(
      fc.asyncProperty(fc.stringMatching(/^[a-z]{4,10}$/), fc.stringMatching(/^[A-Za-z0-9]{12,24}$/), async (user, secret) => {
        const home = `/home/${user}`;
        const { client } = await connectCostFixture({ home, portalApiRemote: `https://${user}:${secret}@github.com/acme/portal-api.git` });
        try {
          for (const [name, result] of await callEvery(client)) {
            expect(result.isError, name).not.toBe(true);
            const text = JSON.stringify(result);
            expect(text, name).not.toContain(secret);
            expect(text, name).not.toContain(home);
          }
          // threat-model.md §5.6: the model can't ask for paths either; an
          // includePaths argument (the old way) is ignored.
          expect(JSON.stringify(await client.callTool({ name: "list_repositories", arguments: { includePaths: true } }))).not.toContain(home);
        } finally {
          await client.close();
        }
      }),
      { numRuns: 6 },
    );
  }, 60_000);

  // threat-model.md §5.6: client names and billing codes reach the model only
  // in a statement, and in list_projects only when the user opted in.
  it("names a project's client and billing code only in get_statement by default", async () => {
    const { client } = await connectCostFixture({ projects: withBillingCode });
    try {
      for (const [name, result] of await callEvery(client)) {
        const text = JSON.stringify(result);
        if (name === "get_statement") {
          expect(text, name).toContain(CLIENT);
          expect(text, name).toContain(BILLING_CODE);
        } else {
          expect(text, name).not.toContain(CLIENT);
          expect(text, name).not.toContain(BILLING_CODE);
        }
      }
    } finally {
      await client.close();
    }
  });

  it("adds them to list_projects only with the projectBillingDetails opt-in", async () => {
    const { client } = await connectCostFixture({ projects: withBillingCode, projectBillingDetails: true });
    try {
      for (const [name, result] of await callEvery(client)) {
        const text = JSON.stringify(result);
        if (NAMED_CLIENT_TOOLS.includes(name)) {
          expect(text, name).toContain(CLIENT);
          expect(text, name).toContain(BILLING_CODE);
        } else {
          expect(text, name).not.toContain(CLIENT);
          expect(text, name).not.toContain(BILLING_CODE);
        }
      }
    } finally {
      await client.close();
    }
  });
});
