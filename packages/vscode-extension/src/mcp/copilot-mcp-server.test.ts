import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  seedCopilotSessionStore,
  USAGE_SESSION_ID,
  writeUsageDebugLog,
} from "@agent-cost-analyzer/server/src/test-support/copilot-session-store";
import {
  AGENT_HOST_FIXTURE_SESSION_IDS,
  writeAgentHostCatalog,
  writeAgentSessionDb,
} from "@agent-cost-analyzer/server/src/test-support/agent-host-user-data-dir";
import {
  COPILOT_CLI_FIXTURE_HOME,
  COPILOT_CLI_FIXTURE_SESSION_IDS,
  writeCopilotCliAgentHostStores,
} from "@agent-cost-analyzer/server/src/test-support/copilot-cli-fixtures";
import { createCopilotMcpServer, type CopilotMcpServerOptions } from "./copilot-mcp-server.js";

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;

function costOf(result: ToolResult): number | null {
  return (result.structuredContent as { totals: { aiCredits: { value: number | null } } }).totals.aiCredits.value;
}

// The MCP server the child process runs, over a VS Code user-data dir laid
// out as Copilot Chat writes it; only the user-data dir is given (D4).
describe("createCopilotMcpServer (vscode-extension.md D7)", () => {
  let userDataDir: string;
  let client: Client;

  beforeAll(async () => {
    userDataDir = mkdtempSync(path.join(tmpdir(), "copilot-mcp-server-"));
    seedCopilotSessionStore(
      path.join(userDataDir, "User", "globalStorage", "github.copilot-chat", "session-store.db"),
      new Date().toISOString(),
    );
    const server = createCopilotMcpServer({ userDataDir, version: "0.1.0-test" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterAll(async () => {
    await client?.close();
    rmSync(userDataDir, { recursive: true, force: true });
  });

  it("serves the 9 read-only tools with the given version", async () => {
    const { tools } = await client.listTools();

    expect(tools).toHaveLength(9);
    expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
    expect(client.getServerVersion()?.version).toBe("0.1.0-test");
  });

  it("reads the session store under the user-data dir", async () => {
    const result = await client.callTool({ name: "list_sessions", arguments: {} });

    expect((result.structuredContent as { sessions: { id: string }[] }).sessions.map((session) => session.id)).toEqual([USAGE_SESSION_ID]);
  });

  it("reads VS Code Agent Host sessions under the same user-data dir, created after it started (step 10.13)", async () => {
    writeAgentHostCatalog(userDataDir);
    writeAgentSessionDb(userDataDir, AGENT_HOST_FIXTURE_SESSION_IDS.withTurns);
    writeAgentSessionDb(userDataDir, AGENT_HOST_FIXTURE_SESSION_IDS.second);

    const result = await client.callTool({ name: "list_sessions", arguments: {} });

    expect((result.structuredContent as { sessions: { id: string }[] }).sessions.map((session) => session.id)).toEqual(
      expect.arrayContaining([USAGE_SESSION_ID, AGENT_HOST_FIXTURE_SESSION_IDS.withTurns, AGENT_HOST_FIXTURE_SESSION_IDS.second]),
    );
  });

  it("finds a workspace's debug logs created after it started, on the next call", async () => {
    expect(costOf(await client.callTool({ name: "get_session_cost", arguments: { sessionId: USAGE_SESSION_ID } }))).toBeNull();

    writeUsageDebugLog(path.join(userDataDir, "User", "workspaceStorage", "late-workspace", "GitHub.copilot-chat", "debug-logs"));

    expect(costOf(await client.callTool({ name: "get_session_cost", arguments: { sessionId: USAGE_SESSION_ID } }))).toBeGreaterThan(0);
  });
});

// Step 10.14: the Copilot CLI's home isn't under the user-data dir; the child
// process resolves it from the environment the extension host passes on.
describe("createCopilotMcpServer with Agent Host event logs (step 10.14)", () => {
  let userDataDir: string;

  beforeAll(() => {
    userDataDir = mkdtempSync(path.join(tmpdir(), "copilot-mcp-server-event-log-"));
    writeCopilotCliAgentHostStores(userDataDir);
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    rmSync(userDataDir, { recursive: true, force: true });
  });

  async function turnText(options: CopilotMcpServerOptions): Promise<{ userMessage: string; textUnavailableReason?: string }> {
    const server = createCopilotMcpServer(options);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const result = await client.callTool({
        name: "get_turn",
        arguments: { sessionId: COPILOT_CLI_FIXTURE_SESSION_IDS.normal, turnIndex: 0 },
      });
      return result.structuredContent as { userMessage: string; textUnavailableReason?: string };
    } finally {
      await client.close();
    }
  }

  it("reads a turn's text from the event log under COPILOT_HOME", async () => {
    vi.stubEnv("COPILOT_HOME", COPILOT_CLI_FIXTURE_HOME);

    const view = await turnText({ userDataDir, version: "0.1.0-test" });

    expect(view.userMessage).toBe("Example prompt one: please list the source files.");
    expect(view.textUnavailableReason).toBeUndefined();
  });

  it("reads no event log for an explicit null Copilot home", async () => {
    vi.stubEnv("COPILOT_HOME", COPILOT_CLI_FIXTURE_HOME);

    const view = await turnText({ userDataDir, version: "0.1.0-test", copilotHome: null });

    expect(view.textUnavailableReason).toMatch(/Copilot CLI home/);
  });
});
