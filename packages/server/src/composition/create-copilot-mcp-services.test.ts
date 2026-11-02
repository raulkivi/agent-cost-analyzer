import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { costRollupSchema, logProviderStatusSchema } from "@agent-cost-analyzer/domain";
import { createMcpServer, type McpServerDeps } from "../mcp/mcp-server.js";
import { seedCopilotSessionStore, USAGE_SESSION_ID, writeUsageDebugLog } from "../test-support/copilot-session-store.js";
import { composeLogProviders } from "./compose-log-providers.js";
import { STANDALONE_MCP_IDENTITY } from "../mcp/mcp-identity.js";
import { COPILOT_MCP_IDENTITY, createCopilotMcpServices } from "./create-copilot-mcp-services.js";
import { createMcpServices } from "./mcp-services.js";

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
    standalone = await connect(createMcpServices(registry, "0.1.0-test"));
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

  it("lists the same 9 tools as the standalone server, with the same input and output schemas", async () => {
    const { tools } = await copilot.listTools();

    expect(tools).toHaveLength(9);
    expect(withoutIdentityText(tools)).toEqual(withoutIdentityText((await standalone.listTools()).tools));
    for (const tool of tools) {
      expect(tool.outputSchema?.type, tool.name).toBe("object");
    }
  });

  it("offers the same prompts as the standalone server", async () => {
    expect((await copilot.listPrompts()).prompts).toEqual((await standalone.listPrompts()).prompts);
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
