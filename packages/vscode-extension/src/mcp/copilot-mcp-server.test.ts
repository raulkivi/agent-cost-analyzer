import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  seedCopilotSessionStore,
  USAGE_SESSION_ID,
  writeUsageDebugLog,
} from "@copilot-cost-analyzer/server/src/test-support/copilot-session-store";
import { createCopilotMcpServer } from "./copilot-mcp-server.js";

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

  it("finds a workspace's debug logs created after it started, on the next call", async () => {
    expect(costOf(await client.callTool({ name: "get_session_cost", arguments: { sessionId: USAGE_SESSION_ID } }))).toBeNull();

    writeUsageDebugLog(path.join(userDataDir, "User", "workspaceStorage", "late-workspace", "GitHub.copilot-chat", "debug-logs"));

    expect(costOf(await client.callTool({ name: "get_session_cost", arguments: { sessionId: USAGE_SESSION_ID } }))).toBeGreaterThan(0);
  });
});
