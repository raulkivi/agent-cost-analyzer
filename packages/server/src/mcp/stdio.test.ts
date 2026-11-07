// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { costRollupSchema, priceBookListingSchema, projectListSchema, repositoryListSchema, sessionCostSchema } from "@agent-cost-analyzer/domain";

// End-to-end: spawns the real stdio entry point (what `claude mcp add`
// runs) against a temporary HOME holding the real-capture Claude Code
// fixture. Also proves nothing else writes to stdout, which would corrupt
// the JSON-RPC stream.
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const fixtureProjectDir = path.resolve(here, "../../fixtures/claude-code-audit/-home-dev-project");

describe("stdio MCP entry point", () => {
  let home: string;
  let client: Client;

  beforeAll(async () => {
    home = mkdtempSync(path.join(tmpdir(), "mcp-stdio-home-"));
    cpSync(fixtureProjectDir, path.join(home, ".claude", "projects", "-home-dev-project"), { recursive: true });
    client = new Client({ name: "stdio-test", version: "1.0.0" });
    await client.connect(
      new StdioClientTransport({
        command: path.join(repoRoot, "node_modules", ".bin", "tsx"),
        args: [path.join(here, "stdio.ts")],
        env: { PATH: process.env.PATH ?? "", HOME: home },
        stderr: "ignore",
      }),
    );
  }, 60_000);

  afterAll(async () => {
    await client?.close();
    rmSync(home, { recursive: true, force: true });
  });

  it("audits the fixture session through the claude-code provider", async () => {
    const sessions = await client.callTool({ name: "list_sessions", arguments: { provider: "claude-code" } });
    const [session] = (sessions.structuredContent as { sessions: { id: string }[] }).sessions;

    const audit = await client.callTool({ name: "get_session_audit", arguments: { sessionId: session.id, provider: "claude-code" } });

    expect(audit.isError).toBeFalsy();
    expect((audit.structuredContent as { totals: { failed: number } }).totals.failed).toBe(10);
  }, 60_000);

  it("reports the fixture session's real token totals and keeps its AI Credits unknown, not 0", async () => {
    const sessions = await client.callTool({ name: "list_sessions", arguments: { provider: "claude-code" } });
    const [session] = (sessions.structuredContent as { sessions: { id: string }[] }).sessions;

    const result = await client.callTool({ name: "get_session_cost", arguments: { sessionId: session.id, provider: "claude-code" } });
    const cost = sessionCostSchema.parse(result.structuredContent);

    expect(cost.totals.output.knownTurns).toBe(cost.turnCount);
    expect(cost.totals.output.value).toBeGreaterThan(0);
    expect(cost.totals.inputTokens.value).toBeGreaterThan(0);
    expect(cost.totals.aiCredits.value).toBeNull();
    expect(cost.unavailableReasons.length).toBeGreaterThan(0);
  }, 60_000);

  it("rolls up cost and lists findings across every provider", async () => {
    const rollup = await client.callTool({ name: "get_cost_rollup", arguments: {} });
    expect(rollup.isError).toBeFalsy();
    expect(costRollupSchema.parse(rollup.structuredContent).byProvider.map((p) => p.providerId)).toContain("claude-code");

    const findings = await client.callTool({ name: "list_findings", arguments: {} });
    expect(findings.isError).toBeFalsy();
  }, 60_000);

  // Phase 15 step 15.5: the standalone server serves the bundled price book.
  it("returns the price book in force at a date", async () => {
    const result = await client.callTool({ name: "get_price_book", arguments: { channel: "github-copilot", model: "claude-sonnet-5.5", at: "2026-11-05" } });

    expect(result.isError).toBeFalsy();
    expect(priceBookListingSchema.parse(result.structuredContent).versions.map((version) => version.id)).toEqual([
      "github-copilot:claude-sonnet-5.5:2026-10-07",
    ]);
  }, 60_000);

  it("lists the fixture session's repository and the (missing) projects file without local paths (step 15.4)", async () => {
    const repositories = await client.callTool({ name: "list_repositories", arguments: { provider: "claude-code" } });
    const projects = await client.callTool({ name: "list_projects", arguments: {} });

    expect(repositoryListSchema.parse(repositories.structuredContent).repositories.length + repositoryListSchema.parse(repositories.structuredContent).unattributed.length).toBeGreaterThan(0);
    expect(projectListSchema.parse(projects.structuredContent)).toMatchObject({ status: "missing", projects: [] });
    expect(JSON.stringify([repositories, projects])).not.toContain(home);
  }, 60_000);
});
