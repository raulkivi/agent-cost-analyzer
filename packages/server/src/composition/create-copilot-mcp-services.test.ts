// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { costRollupSchema, logProviderStatusSchema, priceBookListingSchema, projectListSchema, repositoryListSchema, sessionCostSchema } from "@agent-cost-analyzer/domain";
import { createMcpServer, type McpServerDeps } from "../mcp/mcp-server.js";
import { seedCopilotSessionStore, USAGE_SESSION_ID, writeUsageDebugLog } from "../test-support/copilot-session-store.js";
import { composeLogProviders } from "./compose-log-providers.js";
import { STANDALONE_MCP_IDENTITY } from "../mcp/mcp-identity.js";
import { COPILOT_MCP_IDENTITY, createCopilotMcpServices } from "./create-copilot-mcp-services.js";
import { createMcpServices } from "./mcp-services.js";
import { loadVendorProfiles } from "../data-sources/vendor-profiles/loader.js";
import { createStandaloneAttribution } from "./create-standalone-attribution.js";
import { createStandalonePriceBook } from "./create-price-book.js";
import { createTurnPricer } from "./create-turn-pricer.js";
import { InMemoryStatementStore } from "../test-support/in-memory-statement-store.js";
import { FIXTURE_VENDOR_PROFILES_DIR } from "../test-support/vendor-profiles-dir.js";

const BILLING_TOOLS = ["get_statement", "estimate_cost"];
const BILLING_PROMPTS = ["prepare_statement", "estimate_work"];

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;

async function connect(deps: McpServerDeps): Promise<Client> {
  const server = createMcpServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function textOf(result: ToolResult): string {
  return (result.content as { text: string }[])[0]!.text;
}

// The actionable error the guard (mcp/tool-helpers.ts) gives for an id the
// registry doesn't know.
function unknownProviderMessage(providerId: string, known: string[]): string {
  return `Unknown log provider id "${providerId}". Known providers: ${known.join(", ")}. Call list_log_providers for availability.`;
}

// Every tool that takes a `provider`, with the smallest valid other arguments.
const PROVIDER_TOOLS: [name: string, args: Record<string, unknown>][] = [
  ["list_sessions", {}],
  ["get_session_cost", { sessionId: USAGE_SESSION_ID }],
  ["get_session_audit", { sessionId: USAGE_SESSION_ID }],
  ["list_tool_calls", { sessionId: USAGE_SESSION_ID }],
  ["get_turn", { sessionId: USAGE_SESSION_ID, turnIndex: 0 }],
  ["get_audit_rollup", {}],
  ["get_cost_rollup", {}],
  ["list_findings", {}],
];

describe("createCopilotMcpServices (the extension's MCP server, vscode-extension.md D7)", () => {
  let dir: string;
  let copilot: Client;
  let standalone: Client;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "copilot-mcp-services-"));
    const sessionStoreDbPath = path.join(dir, "session-store.db");
    const debugLogsDir = path.join(dir, "debug-logs");
    seedCopilotSessionStore(sessionStoreDbPath, new Date().toISOString());
    writeUsageDebugLog(debugLogsDir);

    copilot = await connect(
      createCopilotMcpServices({
        sessionStoreDbPath,
        debugLogsDirPaths: [debugLogsDir],
        agentTracesDbPath: null,
        agentHostUserDataDir: null,
        copilotHome: null,
        appVersion: "0.1.0-test",
        vendorProfilesDir: FIXTURE_VENDOR_PROFILES_DIR,
      }),
    );
    // The standalone server as mcp/stdio.ts builds it, over the same Copilot
    // data and no other provider's.
    const { registry } = composeLogProviders({
      sessionStoreDbPath,
      debugLogsDirPaths: [debugLogsDir],
      agentTracesDbPath: null,
      agentHostUserDataDir: null,
      vscodeSettingsPath: null,
      appSettingsDir: dir,
      mitmproxyCapturesDirPath: null,
      piAgentSessionsDirPath: null,
      systemPromptLogPath: null,
      claudeCodeProjectsDirPath: null,
    });
    // Step 15.13: with its projects file (none here), price book and statements.
    const attribution = createStandaloneAttribution(registry, dir);
    const priceBook = createStandalonePriceBook(dir, attribution.catalog);
    standalone = await connect({
      ...createMcpServices(registry, "0.1.0-test", undefined, attribution, createTurnPricer(priceBook), priceBook, {
        store: new InMemoryStatementStore(),
        projects: attribution.catalog,
        priceBookHash: () => "test",
      }, { profiles: loadVendorProfiles(), priceBook }),
      priceBook,
    });
  });

  afterAll(async () => {
    await copilot?.close();
    await standalone?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // Names and the texts that name log sources are the only intended
  // difference (mcp/mcp-identity.ts); everything else must match exactly.
  const withoutIdentityText = (tools: Awaited<ReturnType<Client["listTools"]>>["tools"]) =>
    tools.map((tool) => {
      const { description, inputSchema, ...rest } = tool;
      const properties = Object.fromEntries(
        Object.entries((inputSchema.properties ?? {}) as Record<string, object>).map(([key, value]) => [
          key,
          key === "provider" ? { ...value, description: undefined } : value,
        ]),
      );
      return { ...rest, description: tool.name === "list_log_providers" ? undefined : description, inputSchema: { ...inputSchema, properties } };
    });

  // Step 15.13 (plan §10.1.4, §10.1.6): every group but billing (D7).
  // Phase 14 step 14.5 (D5): both serve the replay group.
  it("lists the standalone server's tools but the billing ones (19 of 21), with the same input and output schemas", async () => {
    const { tools } = await copilot.listTools();
    const standaloneTools = (await standalone.listTools()).tools;

    expect(standaloneTools).toHaveLength(21);
    expect(tools).toHaveLength(19);
    for (const name of ["replay_session", "compare_models_for_session"]) {
      expect(tools.map((tool) => tool.name)).toContain(name);
      expect(standaloneTools.map((tool) => tool.name)).toContain(name);
    }
    expect(withoutIdentityText(tools)).toEqual(withoutIdentityText(standaloneTools.filter((tool) => !BILLING_TOOLS.includes(tool.name))));
    for (const tool of tools) {
      expect(tool.outputSchema?.type, tool.name).toBe("object");
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
    }
  });

  it("offers the standalone server's prompts but the billing ones (4 of 6)", async () => {
    const standalonePrompts = (await standalone.listPrompts()).prompts;

    expect(standalonePrompts).toHaveLength(6);
    expect((await copilot.listPrompts()).prompts).toEqual(standalonePrompts.filter((prompt) => !BILLING_PROMPTS.includes(prompt.name)));
  });

  it("answers replay_session over the Copilot provider: the session replayed, or why not, never a thrown stack", async () => {
    const result = await copilot.callTool({ name: "replay_session", arguments: { sessionId: USAGE_SESSION_ID, model: "claude-haiku-5.5" } });
    const text = JSON.stringify(result);

    if (result.isError) expect(textOf(result)).not.toMatch(/\bat .*\.(ts|js):\d+/);
    else expect(result.structuredContent).toMatchObject({ simulated: true, sessionId: USAGE_SESSION_ID, model: "claude-haiku-5.5" });
    expect(text).not.toContain(dir);
    const unknownModel = await copilot.callTool({ name: "replay_session", arguments: { sessionId: USAGE_SESSION_ID, model: "not-a-model" } });
    expect(unknownModel.isError).toBe(true);
  });

  it("lists no projects and says why: projects are edited in the standalone app (D19)", async () => {
    const list = projectListSchema.parse((await copilot.callTool({ name: "list_projects", arguments: {} })).structuredContent);

    expect(list.projects).toEqual([]);
    expect(list.reason).toMatch(/Agent Cost Analyzer app/);
    expect(projectListSchema.parse((await standalone.callTool({ name: "list_projects", arguments: {} })).structuredContent).reason).toBeUndefined();
  });

  it("reads the bundled price book and lists repositories over the Copilot provider", async () => {
    const book = priceBookListingSchema.parse((await copilot.callTool({ name: "get_price_book", arguments: { channel: "github-copilot" } })).structuredContent);
    const repositories = repositoryListSchema.parse((await copilot.callTool({ name: "list_repositories", arguments: {} })).structuredContent);

    expect(book.versions.length).toBeGreaterThan(0);
    expect(book.versions.every((version) => version.origin === "bundled")).toBe(true);
    expect([...repositories.repositories, ...repositories.unattributed].length).toBeGreaterThan(0);
  });

  it("is named ai-credits-analyzer and speaks only of Copilot", async () => {
    const { tools } = await copilot.listTools();
    const texts = [
      copilot.getInstructions() ?? "",
      ...tools.flatMap((tool) => [
        tool.description ?? "",
        JSON.stringify((tool.inputSchema.properties as { provider?: { description?: string } }).provider?.description ?? ""),
      ]),
    ].join("\n");

    expect(copilot.getServerVersion()?.name).toBe("ai-credits-analyzer");
    expect(copilot.getInstructions()).toBe(COPILOT_MCP_IDENTITY.instructions);
    expect(texts).not.toMatch(/Claude Code|\bpi\b|pi-agent|mitmproxy/i);
    expect(texts).toContain("GitHub Copilot");
  });

  it("is titled AI Credits Analyzer, by the same author and repo as the standalone server", () => {
    const info = copilot.getServerVersion()!;

    expect(info.title).toBe("AI Credits Analyzer");
    expect(info.description).toContain("by Raul Kivi");
    expect(info.description).not.toMatch(/Claude Code|\bpi\b|mitmproxy/i);
    expect(info.websiteUrl).toBe("https://github.com/raulkivi/agent-cost-analyzer");
    expect(info.icons).toEqual(standalone.getServerVersion()!.icons);
  });

  it("leaves the standalone server's name and instructions untouched", () => {
    expect(standalone.getServerVersion()?.name).toBe("agent-cost-analyzer");
    expect(standalone.getInstructions()).toBe(STANDALONE_MCP_IDENTITY.instructions);
  });

  it("reports the extension's version", () => {
    expect(copilot.getServerVersion()?.version).toBe("0.1.0-test");
  });

  it("lists only the vscode provider, available and active", async () => {
    const result = await copilot.callTool({ name: "list_log_providers", arguments: {} });
    const status = logProviderStatusSchema.parse(result.structuredContent);

    expect(status.activeProviderId).toBe("vscode");
    expect(status.providers).toEqual([expect.objectContaining({ id: "vscode", available: true })]);
  });

  it("lists sessions of the vscode provider only", async () => {
    const result = await copilot.callTool({ name: "list_sessions", arguments: {} });
    const { sessions } = result.structuredContent as { sessions: { id: string; providerId?: string }[] };

    expect(sessions.map((session) => session.id)).toEqual([USAGE_SESSION_ID]);
    expect(sessions.every((session) => session.providerId === undefined || session.providerId === "vscode")).toBe(true);
  });

  it("rolls cost up over the vscode provider only, with the session's known AI Credits", async () => {
    const result = await copilot.callTool({ name: "get_cost_rollup", arguments: {} });
    const rollup = costRollupSchema.parse(result.structuredContent);

    expect(rollup.byProvider.map((provider) => provider.providerId)).toEqual(["vscode"]);
    expect(rollup.byProvider[0]!.sessions).toBe(1);
    expect(rollup.totals.aiCredits.value).toBeGreaterThan(0);
  });

  // Check 2.3: the tools give the AI Credits the Sessions view shows. The
  // fixture's debug log has a turn the session store has no row for; its
  // four requests' copilotUsageNanoAiu sum to 9.64735 AI Credits.
  it("gives the session's AI Credits and turn count the same in list_sessions, get_session_cost and get_cost_rollup", async () => {
    const SESSION_AI_CREDITS = (4_543_550_000 + 2_795_980_000 + 1_404_890_000 + 902_930_000) / 1e9;
    const listed = await copilot.callTool({ name: "list_sessions", arguments: {} });
    const cost = await copilot.callTool({ name: "get_session_cost", arguments: { sessionId: USAGE_SESSION_ID } });
    const rollup = costRollupSchema.parse((await copilot.callTool({ name: "get_cost_rollup", arguments: {} })).structuredContent);
    const [summary] = (listed.structuredContent as { sessions: { turnCount: number }[] }).sessions;
    const sessionCost = sessionCostSchema.parse(cost.structuredContent);

    expect(sessionCost.totals.aiCredits.value).toBeCloseTo(SESSION_AI_CREDITS, 9);
    expect(sessionCost.totals.aiCredits.knownTurns).toBe(sessionCost.totals.aiCredits.turns);
    expect(rollup.totals.aiCredits.value).toBeCloseTo(SESSION_AI_CREDITS, 9);
    expect(sessionCost.turnCount).toBe(2);
    expect(summary!.turnCount).toBe(sessionCost.turnCount);
  });

  it("gives the standalone server's actionable unknown-provider error for an id it doesn't know", async () => {
    const result = await standalone.callTool({ name: "list_sessions", arguments: { provider: "nope" } });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(unknownProviderMessage("nope", ["vscode", "mitmproxy", "pi-agent", "claude-code"]));
  });

  it.each(["claude-code", "pi-agent", "mitmproxy"])("treats %s as an unknown provider in every tool that takes one", async (providerId) => {
    for (const [name, args] of PROVIDER_TOOLS) {
      const result = await copilot.callTool({ name, arguments: { ...args, provider: providerId } });

      expect(result.isError, name).toBe(true);
      expect(textOf(result), name).toBe(unknownProviderMessage(providerId, ["vscode"]));
    }
  });
});
