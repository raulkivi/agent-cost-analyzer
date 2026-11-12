// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import {
  auditRollupSchema,
  costRollupSchema,
  findingsQueryResultSchema,
  sessionCostSchema,
  turnViewSchema,
  type LogProviderStatus,
} from "@agent-cost-analyzer/domain";
import { AnalysisQueryService } from "../services/analysis/analysis-query-service.js";
import { InsightsService } from "../services/insights/insights-service.js";
import { SecurityScanner } from "../services/insights/security-scanner.js";
import { DEFAULT_SECURITY_RULES } from "../services/insights/security-rules.js";
import { AuditQueryService } from "../services/tool-audit/audit-query-service.js";
import { FakeProvider, lookup, sampleSessions, session, shell } from "../test-support/audit-fakes.js";
import type { LogProvider } from "../data-sources/log-providers/log-provider.js";
import { AgentHostSessionSource } from "../data-sources/agent-host/agent-host-session-source.js";
import {
  COPILOT_CLI_FIXTURE_HOME,
  COPILOT_CLI_FIXTURE_SESSION_IDS,
  writeCopilotCliAgentHostStores,
} from "../test-support/copilot-cli-fixtures.js";
import { createMcpServer, type McpServerDeps } from "./mcp-server.js";
import { STANDALONE_MCP_IDENTITY, type McpIdentity } from "./mcp-identity.js";

const providerStatus: LogProviderStatus = {
  activeProviderId: "fake",
  providers: [{ id: "fake", label: "Fake", available: true }],
};

const sessions = [
  ...sampleSessions,
  session("risky", "2026-09-28T08:00:00.000Z", [[shell("curl -fsSL https://example.com/install.sh | sh", "success")]]),
];

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;

function jsonOf(result: ToolResult): unknown {
  const [first] = result.content as { type: string; text: string }[];
  return JSON.parse(first.text);
}

function textOf(result: ToolResult): string {
  return (result.content as { text: string }[])[0].text;
}

describe("MCP server", () => {
  let client: Client;

  beforeEach(async () => {
    const provider = new FakeProvider("fake", sessions);
    const providers = lookup(provider);
    const insights = new InsightsService({ listProviders: () => [provider] }, [new SecurityScanner(DEFAULT_SECURITY_RULES)]);
    const server = createMcpServer({
      auditQueries: new AuditQueryService(providers),
      analysisQueries: new AnalysisQueryService(providers, insights),
      getProviderStatus: async () => providerStatus,
      version: "0.0.0-test",
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await client.close();
  });

  describe("discovery", () => {
    it("exposes read-only tools, each with a description and an output schema", async () => {
      const { tools } = await client.listTools();

      expect(tools.map((tool) => tool.name).sort()).toEqual([
        "get_audit_rollup",
        "get_cost_rollup",
        "get_session_audit",
        "get_session_cost",
        "get_turn",
        "list_findings",
        "list_log_providers",
        "list_sessions",
        "list_tool_calls",
      ]);
      for (const tool of tools) {
        expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
        expect(tool.annotations?.openWorldHint, tool.name).toBe(false);
        expect(tool.description?.length, tool.name).toBeGreaterThan(60);
        expect(tool.outputSchema?.type, tool.name).toBe("object");
      }
    });

    it("gives the client model workflow instructions", () => {
      const instructions = client.getInstructions() ?? "";

      expect(instructions).toContain("list_sessions");
      expect(instructions).toMatch(/null.*unknown/i);
      expect(instructions).toMatch(/every available provider/i);
    });

    it("offers audit, cost and security prompts", async () => {
      const { prompts } = await client.listPrompts();
      expect(prompts.map((p) => p.name).sort()).toEqual(["audit_session", "review_costs", "security_review"]);

      const audit = await client.getPrompt({ name: "audit_session", arguments: { sessionId: "mid" } });
      expect((audit.messages[0].content as { text: string }).text).toContain("get_session_audit");

      const costs = await client.getPrompt({ name: "review_costs", arguments: { since: "2026-09-01" } });
      const costText = (costs.messages[0].content as { text: string }).text;
      expect(costText).toContain("get_cost_rollup");
      expect(costText).toContain("2026-09-01");

      const security = await client.getPrompt({ name: "security_review", arguments: {} });
      expect((security.messages[0].content as { text: string }).text).toContain("list_findings");
    });
  });

  describe("sessions", () => {
    it("list_log_providers returns the provider status", async () => {
      const result = await client.callTool({ name: "list_log_providers", arguments: {} });
      expect(jsonOf(result)).toEqual(providerStatus);
    });

    it("list_sessions returns compact summaries in a date window with the total match count", async () => {
      const result = await client.callTool({ name: "list_sessions", arguments: { since: "2026-09-15", limit: 2 } });

      expect(jsonOf(result)).toEqual({
        total: 3,
        sessions: [
          { id: "risky", title: "Session risky", startedAt: "2026-09-28T08:00:00.000Z", turnCount: 1, model: "m", providerId: "fake" },
          { id: "new", title: "Session new", startedAt: "2026-09-27T08:00:00.000Z", turnCount: 2, model: "m", providerId: "fake" },
        ],
      });
    });

    it("list_sessions searches titles and ids", async () => {
      const result = (await client.callTool({ name: "list_sessions", arguments: { query: "MID" } })).structuredContent as {
        sessions: { id: string }[];
      };
      expect(result.sessions.map((s) => s.id)).toEqual(["mid"]);
    });

    it("get_turn returns one bounded turn", async () => {
      const result = await client.callTool({ name: "get_turn", arguments: { sessionId: "mid", turnIndex: 0 } });

      const view = turnViewSchema.parse(jsonOf(result));
      expect(view.toolCalls.map((c) => c.status)).toEqual(["success", "error"]);
    });

    it("get_turn explains an out-of-range turn index", async () => {
      const result = await client.callTool({ name: "get_turn", arguments: { sessionId: "mid", turnIndex: 7 } });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/1 turn.*0\.\.0/);
    });
  });

  describe("audit", () => {
    it("get_session_audit omits the per-call list unless asked, to keep responses small", async () => {
      const compact = jsonOf(await client.callTool({ name: "get_session_audit", arguments: { sessionId: "mid" } })) as Record<
        string,
        unknown
      >;
      expect(compact.calls).toBeUndefined();
      expect((compact.totals as { failed: number }).failed).toBe(1);

      const full = jsonOf(
        await client.callTool({ name: "get_session_audit", arguments: { sessionId: "mid", includeCalls: true } }),
      ) as { calls: unknown[] };
      expect(full.calls).toHaveLength(2);
    });

    it("list_tool_calls filters by status and category", async () => {
      const result = await client.callTool({
        name: "list_tool_calls",
        arguments: { sessionId: "mid", status: ["error"], failureCategory: ["wrong-directory"] },
      });

      const body = jsonOf(result) as { total: number; calls: { call: { shell: { command: string } } }[] };
      expect(body.total).toBe(1);
      expect(body.calls[0].call.shell.command).toBe("cd x && ls");
    });

    it("list_tool_calls filters by kind and pages with offset", async () => {
      const result = await client.callTool({
        name: "list_tool_calls",
        arguments: { sessionId: "new", kind: ["shell"], offset: 1, limit: 1 },
      });

      const body = jsonOf(result) as { total: number; offset: number; calls: { turnIndex: number }[] };
      expect(body).toMatchObject({ total: 2, offset: 1 });
      expect(body.calls.map((c) => c.turnIndex)).toEqual([1]);
    });

    it("get_audit_rollup returns a valid rollup", async () => {
      const result = await client.callTool({ name: "get_audit_rollup", arguments: {} });

      const rollup = auditRollupSchema.parse(jsonOf(result));
      expect(rollup.sessionCount).toBe(4);
      expect(rollup.topFailingCommands[0].command).toBe("foo");
    });
  });

  describe("cost", () => {
    it("get_session_cost reports totals with coverage and keeps unknown AI Credits null", async () => {
      const result = await client.callTool({ name: "get_session_cost", arguments: { sessionId: "new", topTurns: 1 } });

      const cost = sessionCostSchema.parse(jsonOf(result));
      expect(cost.totals.output).toMatchObject({ value: 2, knownTurns: 2, turns: 2 });
      expect(cost.totals.aiCredits.value).toBeNull();
      expect(cost.topTurns).toHaveLength(1);
    });

    it("get_cost_rollup aggregates across providers", async () => {
      const result = await client.callTool({ name: "get_cost_rollup", arguments: { since: "2026-09-15" } });

      const rollup = costRollupSchema.parse(jsonOf(result));
      expect(rollup.sessionCount).toBe(3);
      expect(rollup.byProvider.map((p) => p.providerId)).toEqual(["fake"]);
    });
  });

  describe("findings", () => {
    it("list_findings returns security findings resolved to their session", async () => {
      const result = await client.callTool({ name: "list_findings", arguments: { kind: ["security"], minSeverity: "medium" } });

      const body = findingsQueryResultSchema.parse(jsonOf(result));
      expect(body.total).toBeGreaterThan(0);
      expect(body.findings[0]).toMatchObject({ sessionId: "risky", sessionTitle: "Session risky", category: "remote-code-execution" });
    });
  });

  describe("errors", () => {
    it("reports an unknown session with a next step", async () => {
      for (const name of ["get_session_audit", "get_session_cost", "list_tool_calls"]) {
        const result = await client.callTool({ name, arguments: { sessionId: "missing" } });
        expect(result.isError, name).toBe(true);
        expect(textOf(result), name).toMatch(/Unknown session id "missing".*list_sessions/);
      }
    });

    it("reports an unknown provider with the known provider ids", async () => {
      const result = await client.callTool({ name: "list_sessions", arguments: { provider: "nope" } });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('"nope"');
      expect(textOf(result)).toContain("fake");
    });

    it("rejects an invalid enum value through input validation", async () => {
      const result = await client.callTool({ name: "list_tool_calls", arguments: { sessionId: "mid", status: ["bogus"] } });
      expect(result.isError).toBe(true);
    });
  });
});

const providerArgOf = (tools: { name: string; inputSchema: unknown }[], tool: string): string =>
  (tools.find((t) => t.name === tool)!.inputSchema as { properties: { provider: { description: string } } }).properties.provider.description;

// What the standalone server has always said, pinned as literals: the
// extension's identity option must not change a byte of it.
describe("MCP server identity (vscode-extension.md step 10.9)", () => {
  function deps(identity?: McpIdentity): McpServerDeps {
    const provider = new FakeProvider("fake", sessions);
    const providers = lookup(provider);
    const insights = new InsightsService({ listProviders: () => [provider] }, [new SecurityScanner(DEFAULT_SECURITY_RULES)]);
    return {
      auditQueries: new AuditQueryService(providers),
      analysisQueries: new AnalysisQueryService(providers, insights),
      getProviderStatus: async () => providerStatus,
      version: "0.0.0-test",
      ...(identity ? { identity } : {}),
    };
  }

  async function connectTo(identity?: McpIdentity): Promise<Client> {
    const server = createMcpServer(deps(identity));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return client;
  }

  it("keeps the standalone server's name, instructions and provider texts when no identity is given", async () => {
    const client = await connectTo();
    const { tools } = await client.listTools();

    expect(client.getServerVersion()?.name).toBe("agent-cost-analyzer");
    expect(client.getInstructions()).toContain("(GitHub Copilot Chat in VS Code, Claude Code CLI, pi, mitmproxy captures)");
    expect(client.getInstructions()).toBe(STANDALONE_MCP_IDENTITY.instructions);
    expect(tools.find((t) => t.name === "list_log_providers")!.description).toContain("(VS Code Copilot Chat, Claude Code CLI, pi, mitmproxy captures)");
    expect(providerArgOf(tools, "list_sessions")).toBe(
      'Log provider id, e.g. "claude-code", "vscode", "pi-agent", "mitmproxy" (see list_log_providers). Defaults to the provider active in the web app.',
    );
    await client.close();
  });

  it("brands the standalone server with its title, author, GitHub repo and icon", async () => {
    const client = await connectTo();
    const info = client.getServerVersion()!;

    expect(info.title).toBe("Agent Cost Analyzer");
    expect(info.description).toContain("by Raul Kivi");
    expect(info.websiteUrl).toBe("https://github.com/raulkivi/agent-cost-analyzer");
    await client.close();
  });

  // Data URIs, so clients show the icon without the server reaching the
  // network; PNG because the spec only asks clients to support raster.
  it("sends the icon inline as SVG and PNG", async () => {
    const client = await connectTo();
    const icons = client.getServerVersion()!.icons!;
    const decoded = (mimeType: string) => {
      const icon = icons.find((i) => i.mimeType === mimeType)!;
      const prefix = `data:${mimeType};base64,`;
      expect(icon.src.startsWith(prefix), mimeType).toBe(true);
      return Buffer.from(icon.src.slice(prefix.length), "base64");
    };

    expect(decoded("image/svg+xml").toString("utf8")).toMatch(/^<svg[\s\S]*<\/svg>\s*$/);
    expect(decoded("image/png").subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(icons.find((i) => i.mimeType === "image/png")!.sizes).toEqual(["64x64"]);
    await client.close();
  });

  it("applies a given identity's name, instructions and provider texts", async () => {
    const identity: McpIdentity = {
      name: "other-product",
      title: "Other Product",
      description: "Other description.",
      instructions: "Other instructions.",
      logSourcesDescription: "the other source",
      providerArgDescription: "Other provider text.",
    };
    const client = await connectTo(identity);
    const { tools } = await client.listTools();

    expect(client.getServerVersion()?.name).toBe("other-product");
    expect(client.getServerVersion()?.title).toBe("Other Product");
    expect(client.getServerVersion()?.description).toBe("Other description.");
    expect(client.getInstructions()).toBe("Other instructions.");
    expect(tools.find((t) => t.name === "list_log_providers")!.description).toContain("Lists the local agent-log sources (the other source),");
    for (const tool of ["list_sessions", "get_session_audit", "get_session_cost"]) {
      expect(providerArgOf(tools, tool), tool).toBe("Other provider text.");
    }
    await client.close();
  });
});

describe("MCP server, Agent Host sessions", () => {
  let client: Client;

  beforeEach(async () => {
    const agentHost = {
      ...session("ah", "2026-09-28T08:00:00.000Z", [[]]),
      copilotHarness: "agent-host" as const,
      copilotEventLog: { status: "missing" as const, reason: "No Copilot CLI event log was found for this session." },
    };
    const provider = new FakeProvider("fake", [agentHost]);
    const providers = lookup(provider);
    const insights = new InsightsService({ listProviders: () => [provider] }, []);
    const server = createMcpServer({
      auditQueries: new AuditQueryService(providers),
      analysisQueries: new AnalysisQueryService(providers, insights),
      getProviderStatus: async () => providerStatus,
      version: "0.0.0-test",
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await client.close();
  });

  it("list_sessions marks the session's harness", async () => {
    const result = (await client.callTool({ name: "list_sessions", arguments: {} })).structuredContent as {
      sessions: { copilotHarness?: string }[];
    };
    expect(result.sessions[0].copilotHarness).toBe("agent-host");
  });

  it("list_tool_calls and get_session_audit say the tool calls are unavailable rather than empty", async () => {
    const calls = (await client.callTool({ name: "list_tool_calls", arguments: { sessionId: "ah" } })).structuredContent as {
      total: number;
      toolCallsUnavailableReason?: string;
    };
    const audit = (await client.callTool({ name: "get_session_audit", arguments: { sessionId: "ah" } })).structuredContent as {
      toolCallsUnavailableReason?: string;
    };

    expect(calls.total).toBe(0);
    expect(calls.toolCallsUnavailableReason).toMatch(/Copilot CLI event log/);
    expect(audit.toolCallsUnavailableReason).toMatch(/Copilot CLI event log/);
  });

  it("get_turn says the turn's text and tool calls are unavailable", async () => {
    const view = turnViewSchema.parse(jsonOf(await client.callTool({ name: "get_turn", arguments: { sessionId: "ah", turnIndex: 0 } })));

    expect(view.textUnavailableReason).toMatch(/Copilot CLI event log/);
    expect(view.toolCallsUnavailableReason).toMatch(/Copilot CLI event log/);
  });
});

describe("MCP server, Agent Host usage records (step 10.15)", () => {
  let client: Client;
  let userDataDir: string;
  const sessionId = COPILOT_CLI_FIXTURE_SESSION_IDS.usageRecords;

  beforeEach(async () => {
    userDataDir = mkdtempSync(path.join(tmpdir(), "mcp-agent-host-"));
    writeCopilotCliAgentHostStores(userDataDir);
    const source = new AgentHostSessionSource({ userDataDir, copilotHome: COPILOT_CLI_FIXTURE_HOME });
    const provider: LogProvider = {
      id: "fake",
      label: "Fake",
      checkAvailability: () => source.checkAvailability(),
      listSessions: async () => (await source.listSessions()).map((s) => ({ ...s, providerId: "fake" })),
      readSession: async (id) => {
        const read = await source.readSession(id);
        return read && { ...read, providerId: "fake" };
      },
      readTurnDetail: (id, turnIndex) => source.readTurnDetail(id, turnIndex),
    };
    const providers = lookup(provider);
    const insights = new InsightsService({ listProviders: () => [provider] }, []);
    const server = createMcpServer({
      auditQueries: new AuditQueryService(providers),
      analysisQueries: new AnalysisQueryService(providers, insights),
      getProviderStatus: async () => providerStatus,
      version: "0.0.0-test",
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await client.close();
    rmSync(userDataDir, { recursive: true, force: true });
  });

  it("get_session_cost reports cache write and reasoning with the turns that reconcile, input total matching session.db", async () => {
    const cost = sessionCostSchema.parse(jsonOf(await client.callTool({ name: "get_session_cost", arguments: { sessionId } })));

    // Turn 0 reconciles (cache write 300, reasoning 30); turn 3 has only reasoning (40).
    expect(cost.totals.cacheWrite).toMatchObject({ value: 300, knownTurns: 1, turns: 4 });
    expect(cost.totals.reasoning).toMatchObject({ value: 70, knownTurns: 2, turns: 4 });
    // Turn 0: uncached 600 + cache write 300 + cache read 1600 = session.db's 2500 input.
    // Uncached input stays known on every turn (input - cached, minus cache write where known).
    expect(cost.totals.uncachedInput).toMatchObject({ value: 600 + 1000 + 800 + 500, knownTurns: 4 });
    expect(cost.totals.cacheRead.value).toBe(1600 + 2300 + 0 + 1500);
    expect(cost.totals.inputTokens).toMatchObject({ value: 2500, knownTurns: 1, turns: 4 });
    expect(cost.unavailableReasons.some((reason) => /usage records/i.test(reason))).toBe(true);
  });
});

// docs/plans/mcp-apps.md §4.7: a session whose latest turn started within
// 15 minutes is flagged active, in the JSON and in a plain sentence.
describe("active sessions in the cost tools", () => {
  const now = new Date("2026-09-27T09:00:00.000Z");
  const timed = (base: ReturnType<typeof session>, starts: string[]) => ({
    ...base,
    turns: base.turns.map((turn, index) => ({ ...turn, startedAt: starts[index] })),
  });
  const running = timed(session("running", "2026-09-27T08:00:00.000Z", [[], []]), ["2026-09-27T08:00:00.000Z", "2026-09-27T08:57:00.000Z"]);
  const idle = timed(session("idle", "2026-09-26T08:00:00.000Z", [[]]), ["2026-09-26T08:00:00.000Z"]);
  let client: Client;

  beforeEach(async () => {
    const provider = new FakeProvider("fake", [running, idle]);
    const providers = lookup(provider);
    const server = createMcpServer({
      auditQueries: new AuditQueryService(providers),
      analysisQueries: new AnalysisQueryService(providers, new InsightsService({ listProviders: () => [provider] }, [], () => now), {}, () => now),
      getProviderStatus: async () => providerStatus,
      version: "0.0.0-test",
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await client.close();
  });

  const texts = (result: ToolResult) => (result.content as { text: string }[]).map((item) => item.text);

  it("get_session_cost flags an active session and says its figures may still change", async () => {
    const result = await client.callTool({ name: "get_session_cost", arguments: { sessionId: "running" } });

    expect(sessionCostSchema.parse(jsonOf(result))).toMatchObject({ lastTurnAt: "2026-09-27T08:57:00.000Z", active: true });
    expect(texts(result)).toContain(
      "This session is active (its latest turn started 3 minutes ago), so its figures may still change and the latest turn may be incomplete.",
    );
  });

  it("get_session_cost adds no sentence for an idle session", async () => {
    const result = await client.callTool({ name: "get_session_cost", arguments: { sessionId: "idle" } });

    expect(sessionCostSchema.parse(jsonOf(result))).not.toHaveProperty("active");
    expect(texts(result)).toHaveLength(1);
  });

  it("get_cost_rollup names its active top sessions", async () => {
    const result = await client.callTool({ name: "get_cost_rollup", arguments: {} });

    const rollup = costRollupSchema.parse(jsonOf(result));
    expect(rollup.topSessions.find((top) => top.sessionId === "running")).toMatchObject({ active: true });
    expect(rollup.topSessions.find((top) => top.sessionId === "idle")).not.toHaveProperty("active");
    expect(texts(result)).toContain(
      'This top session is active, so its figures may still change and its latest turn may be incomplete: "Session running" (fake running, latest turn started 3 minutes ago).',
    );
  });

  it("tells the model in both tools' descriptions that active figures may still change", async () => {
    const { tools } = await client.listTools();

    for (const name of ["get_session_cost", "get_cost_rollup"]) {
      expect(tools.find((tool) => tool.name === name)?.description, name).toContain(
        "`active`: true marks a session whose latest turn started in the last 15 minutes; its figures may still change.",
      );
    }
  });
});
