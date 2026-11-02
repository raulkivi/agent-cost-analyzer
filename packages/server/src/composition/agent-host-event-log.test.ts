import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { insightsDatasetSchema, sessionAuditSchema, sessionSchema, turnInspectorDetailSchema, turnViewSchema } from "@agent-cost-analyzer/domain";
import { AGENT_HOST_EVENT_LOG_MISSING_REASON } from "../data-sources/agent-host/agent-host-session-source.js";
import { createMcpServer } from "../mcp/mcp-server.js";
import type { ApiService } from "../services/api/api-service.js";
import {
  COPILOT_CLI_FIXTURE_HOME,
  COPILOT_CLI_FIXTURE_SESSION_IDS as IDS,
  writeCopilotCliAgentHostStores,
} from "../test-support/copilot-cli-fixtures.js";
import { InMemoryAppSettingsStore } from "../test-support/in-memory-app-settings-store.js";
import { createCopilotMcpServices } from "./create-copilot-mcp-services.js";
import { createExtensionApiService } from "./create-extension-api-service.js";
import { createStandaloneApiService } from "./create-standalone-api-service.js";

// Step 10.14 end to end: Agent Host stores whose sessions own the Copilot CLI
// fixture logs (fixtures/agent-host/copilot-cli/), read through both
// products' composition roots and the extension's MCP server. The fixture
// dir is the Copilot home; the missing-log session has no log dir there.

const learnScenariosFixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/learn-scenarios");

describe("Agent Host sessions with the Copilot CLI event log (step 10.14)", () => {
  let userDataDir: string;
  let extension: ApiService;
  let standalone: ApiService;
  let mcp: Client;

  beforeAll(async () => {
    userDataDir = mkdtempSync(path.join(tmpdir(), "agent-host-event-log-"));
    writeCopilotCliAgentHostStores(userDataDir);

    const paths = {
      sessionStoreDbPath: null,
      debugLogsDirPaths: [],
      agentTracesDbPath: null,
      agentHostUserDataDir: userDataDir,
      copilotHome: COPILOT_CLI_FIXTURE_HOME,
    };
    extension = createExtensionApiService({
      ...paths,
      vscodeSettingsPath: null,
      appSettings: new InMemoryAppSettingsStore(),
      learnScenariosFixturesDir,
      appVersion: "0.1.0-test",
    });
    standalone = createStandaloneApiService({
      ...paths,
      sessionStoreDbPath: path.join(userDataDir, "no-session-store.db"),
      vscodeSettingsPath: null,
      appSettingsDir: path.join(userDataDir, "app-settings"),
      mitmproxyCapturesDirPath: null,
      piAgentSessionsDirPath: null,
      systemPromptLogPath: null,
      claudeCodeProjectsDirPath: null,
      learnScenariosFixturesDir,
      appVersion: "0.1.0-test",
    });
    const server = createMcpServer(createCopilotMcpServices({ ...paths, appVersion: "0.1.0-test" }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    mcp = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
  });

  afterAll(async () => {
    await mcp?.close();
    rmSync(userDataDir, { recursive: true, force: true });
  });

  describe.each([
    ["the extension", () => extension],
    ["the standalone app", () => standalone],
  ])("in %s", (_product, api) => {
    it("shows a matched session's turn text and tool calls, with tokens and AI Credits from session.db", async () => {
      const session = sessionSchema.parse(await api().getSession(IDS.normal));

      expect(session.copilotEventLog).toEqual({ status: "read" });
      expect(session.turns[0]!.userMessage).toBe("Example prompt one: please list the source files.");
      expect(session.turns[0]!.assistantResponse).toBe("Example answer one.");
      expect(session.turns.flatMap((turn) => turn.toolCalls).length).toBeGreaterThan(0);
      expect(session.costAiCredits.known).toBe(true);
    });

    it("shows a matched turn's inspector rounds and the session's system prompt", async () => {
      const detail = turnInspectorDetailSchema.parse(await api().getTurnDetail(IDS.normal, 0));

      expect(detail.rounds.length).toBeGreaterThan(0);
      expect(detail.unavailableReason).toBeUndefined();
      await expect(api().getSystemPromptText(IDS.normal)).resolves.toMatch(/^You are a coding agent/);
      expect((await api().getSession(IDS.normal)).systemPrompt?.length).toBe(2);
    });

    it("keeps a session without a log unknown with the new reason", async () => {
      const session = await api().getSession(IDS.missingLog);

      expect(session.copilotEventLog).toEqual({ status: "missing", reason: AGENT_HOST_EVENT_LOG_MISSING_REASON });
      await expect(api().getTurnDetail(IDS.missingLog, 0)).resolves.toMatchObject({
        rounds: [],
        unavailableReason: AGENT_HOST_EVENT_LOG_MISSING_REASON,
      });
      await expect(api().getSystemPromptText(IDS.missingLog)).rejects.toThrow(/No system-prompt artifact captured/);
      const audit = sessionAuditSchema.parse(await api().getSessionAudit(IDS.missingLog));
      expect(audit.toolCallsUnavailableReason).toBe(AGENT_HOST_EVENT_LOG_MISSING_REASON);
    });

    it("audits a session whose log was read, and leaves only the missing-log one out of the rollup", async () => {
      const audit = sessionAuditSchema.parse(await api().getSessionAudit(IDS.normal));

      expect(audit.toolCallsUnavailableReason).toBeUndefined();
      expect(audit.totals.toolCalls).toBeGreaterThan(0);
      const rollup = await api().getAuditRollup({ since: "2000-01-01" });
      expect(rollup).toMatchObject({ sessionCount: 4, sessionsWithUnknownToolCalls: 1 });
      expect(rollup.toolCallsUnavailableReason).toBe(AGENT_HOST_EVENT_LOG_MISSING_REASON);
      expect(rollup.totals.toolCalls).toBeGreaterThan(0);
    });

    it("counts only the missing-log session's tool calls as unknown in insights", async () => {
      const dataset = insightsDatasetSchema.parse(await api().getInsights({ since: "2000-01-01" }));

      const unknown = dataset.sessions.filter((session) => session.toolCallsUnavailable).map((session) => session.sessionId);
      expect(unknown).toEqual([IDS.missingLog]);
    });
  });

  describe("in the extension's MCP server", () => {
    it("reads a matched turn's text and tool calls", async () => {
      const result = await mcp.callTool({ name: "get_turn", arguments: { sessionId: IDS.normal, turnIndex: 0 } });
      const view = turnViewSchema.parse(result.structuredContent);

      expect(view.userMessage).toBe("Example prompt one: please list the source files.");
      expect(view.toolCalls.length).toBeGreaterThan(0);
      expect(view.textUnavailableReason).toBeUndefined();
      expect(view.toolCallsUnavailableReason).toBeUndefined();
    });

    it("says why a turn of a session without a log is unknown", async () => {
      const result = await mcp.callTool({ name: "get_turn", arguments: { sessionId: IDS.missingLog, turnIndex: 0 } });
      const view = turnViewSchema.parse(result.structuredContent);

      expect(view.textUnavailableReason).toBe(AGENT_HOST_EVENT_LOG_MISSING_REASON);
      expect(view.toolCallsUnavailableReason).toBe(AGENT_HOST_EVENT_LOG_MISSING_REASON);
    });

    it("lists a read session's tool calls", async () => {
      const result = await mcp.callTool({ name: "list_tool_calls", arguments: { sessionId: IDS.normal } });
      const { total, toolCallsUnavailableReason } = result.structuredContent as { total: number; toolCallsUnavailableReason?: string };

      expect(total).toBeGreaterThan(0);
      expect(toolCallsUnavailableReason).toBeUndefined();
    });
  });
});
