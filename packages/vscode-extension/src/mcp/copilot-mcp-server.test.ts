// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
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
import { FIXTURE_VENDOR_PROFILES_DIR } from "@agent-cost-analyzer/server/src/test-support/vendor-profiles-dir";
import { createCopilotMcpServer, createCopilotMcpServerFactory, type CopilotMcpServerOptions } from "./copilot-mcp-server.js";

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
    const server = createCopilotMcpServer({ userDataDir, version: "0.1.0-test", vendorProfilesDir: FIXTURE_VENDOR_PROFILES_DIR });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterAll(async () => {
    await client?.close();
    rmSync(userDataDir, { recursive: true, force: true });
  });

  // Step 15.13 (plan §10.1.6): every group but billing (D7); Phase 14 step 14.5 adds replay (D5).
  it("serves the 19 read-only tools with the given version, without get_statement or estimate_cost", async () => {
    const { tools } = await client.listTools();

    expect(tools).toHaveLength(19);
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(["replay_session", "compare_models_for_session"]));
    expect(tools.map((tool) => tool.name)).not.toEqual(expect.arrayContaining(["get_statement"]));
    expect(tools.map((tool) => tool.name)).not.toEqual(expect.arrayContaining(["estimate_cost"]));
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

    const view = await turnText({ userDataDir, version: "0.1.0-test", vendorProfilesDir: FIXTURE_VENDOR_PROFILES_DIR });

    expect(view.userMessage).toBe("Example prompt one: please list the source files.");
    expect(view.textUnavailableReason).toBeUndefined();
  });

  it("reads no event log for an explicit null Copilot home", async () => {
    vi.stubEnv("COPILOT_HOME", COPILOT_CLI_FIXTURE_HOME);

    const view = await turnText({ userDataDir, version: "0.1.0-test", copilotHome: null, vendorProfilesDir: FIXTURE_VENDOR_PROFILES_DIR });

    expect(view.textUnavailableReason).toMatch(/Copilot CLI home/);
  });
});

// Phase 12 A13 (mcp-apps.md §4.2, §7): the composition boundary the child
// process uses (mcp/stdio.ts passes <extension>/dist/mcp-apps/views.html).
describe("createCopilotMcpServer with the app views (Phase 12 A13)", () => {
  let dir: string;
  let userDataDir: string;
  const URI = "ui://ai-credits-analyzer/views.html";

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "copilot-mcp-server-views-"));
    userDataDir = path.join(dir, "user-data");
    mkdirSync(path.join(userDataDir, "User"), { recursive: true });
    mkdirSync(path.join(dir, "dist", "mcp-apps"), { recursive: true });
    writeFileSync(path.join(dir, "dist", "mcp-apps", "views.html"), '<!doctype html><html><head><meta name="aca-brand" content=""></head><body>built views</body></html>');
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function connect(appViewsHtml: string | undefined): Promise<Client> {
    const server = createCopilotMcpServer({ userDataDir, version: "0.1.0-test", vendorProfilesDir: FIXTURE_VENDOR_PROFILES_DIR, appViewsHtml });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return client;
  }

  it("serves the views file as text/html;profile=mcp-app and tags the thirteen registered view tools with _meta.ui", async () => {
    const client = await connect(path.join(dir, "dist", "mcp-apps", "views.html"));
    try {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(20);
      expect(
        tools
          .filter((tool) => tool._meta?.ui !== undefined)
          .map((tool) => tool.name)
          .sort(),
      ).toEqual([
        "compare_costs",
        "compare_models_for_session",
        "explain_cost_change",
        "get_audit_rollup",
        "get_cost_rollup",
        "get_price_changes",
        "get_project_cost",
        "get_repository_cost",
        "get_session_audit",
        "get_session_cost",
        "get_turn_series",
        "list_findings",
        "list_sessions",
        "replay_session",
      ]);
      // A26: the extension has no billing group (D7), so no billing view is named.
      expect(tools.map((tool) => tool.name)).not.toEqual(expect.arrayContaining(["get_statement"]));
      expect(tools.map((tool) => tool.name)).not.toEqual(expect.arrayContaining(["estimate_cost"]));
      expect(JSON.stringify(tools.map((tool) => tool._meta ?? {}))).not.toMatch(/statement|estimate|billing|U14|U15/i);
      expect(tools.find((tool) => tool.name === "get_session_cost")!._meta).toMatchObject({ ui: { resourceUri: URI } });
      const { contents } = await client.readResource({ uri: URI });
      expect(contents[0]).toMatchObject({ uri: URI, mimeType: "text/html;profile=mcp-app" });
      expect((contents[0] as { text: string }).text).toContain("built views");
    } finally {
      await client.close();
    }
  });

  it.each([
    ["no path", undefined],
    ["a path to a file that is not there", "/nonexistent/dist/mcp-apps/views.html"],
  ])("lists the 19 normal tools and no views for %s", async (_label, appViewsHtml) => {
    const client = await connect(appViewsHtml);
    try {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(19);
      expect(tools.some((tool) => tool._meta !== undefined)).toBe(false);
    } finally {
      await client.close();
    }
  });
});

// docs/plans/mcp-sdk-2-migration.md M2: serveStdio calls the server factory
// once per connection and once more for a server/discover probe it may
// discard, so the services and the views lookup are composed once, when
// the factory is made, and each call only builds a server over them.
describe("createCopilotMcpServerFactory as serveStdio's factory (MCP SDK 2)", () => {
  let userDataDir: string;

  beforeAll(() => {
    userDataDir = mkdtempSync(path.join(tmpdir(), "copilot-mcp-server-factory-"));
    mkdirSync(path.join(userDataDir, "User"), { recursive: true });
  });
  afterAll(() => {
    rmSync(userDataDir, { recursive: true, force: true });
  });

  it("composes once: calling it twice writes nothing, and each call builds its own server with the 19 tools", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const factory = createCopilotMcpServerFactory({
        userDataDir,
        version: "0.1.0-test",
        vendorProfilesDir: FIXTURE_VENDOR_PROFILES_DIR,
        appViewsHtml: path.join(userDataDir, "missing", "views.html"),
      });
      expect(consoleError).toHaveBeenCalledTimes(1);
      consoleError.mockClear();
      stderr.mockClear();

      const first = factory();
      const second = factory();

      expect(consoleError).not.toHaveBeenCalled();
      expect(stderr).not.toHaveBeenCalled();
      expect(second).not.toBe(first);
      for (const server of [first, second]) {
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: "test-client", version: "1.0.0" });
        await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
        expect((await client.listTools()).tools).toHaveLength(19);
        await client.close();
      }
    } finally {
      stderr.mockRestore();
      consoleError.mockRestore();
    }
  });
});
