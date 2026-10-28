import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  costRollupSchema,
  insightsDatasetSchema,
  sessionAuditSchema,
  sessionCostSchema,
  sessionSchema,
  turnViewSchema,
  type Session,
} from "@agent-cost-analyzer/domain";
import { createMcpServer } from "../mcp/mcp-server.js";
import type { ApiService } from "../services/api/api-service.js";
import {
  AGENT_HOST_FIXTURE_SESSION_IDS as IDS,
  fixtureTurnNanoAiu,
  readAgentHostFixtureRows,
  sessionRowsWithUsageOnly,
  writeAgentHostCatalog,
  writeAgentSessionDb,
} from "../test-support/agent-host-user-data-dir.js";
import { InMemoryAppSettingsStore } from "../test-support/in-memory-app-settings-store.js";
import { createCopilotMcpServices } from "./create-copilot-mcp-services.js";
import { createExtensionApiService } from "./create-extension-api-service.js";
import { createStandaloneApiService } from "./create-standalone-api-service.js";

// Step 10.13 end to end: VS Code Agent Host stores built from the redacted
// fixtures (real DDL and rows) inside a user-data dir, read through both
// products' composition roots and every consumer of the Copilot provider.

const learnScenariosFixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/learn-scenarios");
const sessionRows = readAgentHostFixtureRows("session-rows.json");
const turnNanoAiu = fixtureTurnNanoAiu(sessionRows);
// The fixture's turn_usage totals: 1.285093 + 246.03949 + 35.494578 + 0.1582715.
const FIXTURE_AI_CREDITS = 282.9774325;

describe("Agent Host sessions through the Copilot provider (step 10.13)", () => {
  let userDataDir: string;
  let extension: ApiService;
  let standalone: ApiService;
  let mcp: Client;

  beforeAll(async () => {
    userDataDir = mkdtempSync(path.join(tmpdir(), "agent-host-sessions-"));
    writeAgentHostCatalog(userDataDir);
    // Every turn has usage: the session total is known.
    writeAgentSessionDb(userDataDir, IDS.second, sessionRowsWithUsageOnly(sessionRows));
    // The full fixture, whose third turn has no turn_usage row.
    writeAgentSessionDb(userDataDir, IDS.withTurns, sessionRows);

    const noClassicLogs = { sessionStoreDbPath: null, debugLogsDirPaths: [], agentTracesDbPath: null, agentHostUserDataDir: userDataDir };
    extension = createExtensionApiService({
      ...noClassicLogs,
      vscodeSettingsPath: null,
      appSettings: new InMemoryAppSettingsStore(),
      learnScenariosFixturesDir,
      appVersion: "0.1.0-test",
    });
    standalone = createStandaloneApiService({
      ...noClassicLogs,
      // The standalone app takes no null here; a missing file is its "none".
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
    const server = createMcpServer(createCopilotMcpServices({ ...noClassicLogs, appVersion: "0.1.0-test" }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    mcp = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
  });

  afterAll(async () => {
    await mcp?.close();
    rmSync(userDataDir, { recursive: true, force: true });
  });

  it("sums the fixture's turn AI Credits exactly", () => {
    expect(turnNanoAiu.reduce((sum, nanoAiu) => sum + nanoAiu, 0)).toBe(282_977_432_500);
  });

  describe.each([
    ["the extension", () => extension],
    ["the standalone app", () => standalone],
  ])("in %s", (_product, api) => {
    it("lists the Agent Host sessions as vscode sessions with the fixture's AI Credits", async () => {
      const sessions = await api().listSessions();

      expect(sessions.map((session) => [session.id, session.providerId])).toEqual([
        [IDS.second, "vscode"],
        [IDS.withTurns, "vscode"],
      ]);
      const listed = sessions[0]!;
      expect(() => sessionSchema.parse(listed)).not.toThrow();
      expect(listed.turnCount).toBe(4);
      expect(listed.costAiCredits.known && listed.costAiCredits.value).toBeCloseTo(FIXTURE_AI_CREDITS, 9);
    });

    it("reads a session's turns with each turn's own AI Credits", async () => {
      const session: Session = await api().getSession(IDS.withTurns);

      expect(session.providerId).toBe("vscode");
      expect(session.turns.map((turn) => (turn.usage.costAiCredits.known ? turn.usage.costAiCredits.value : null))).toEqual([
        turnNanoAiu[0]! / 1e9,
        turnNanoAiu[1]! / 1e9,
        null,
        turnNanoAiu[2]! / 1e9,
        turnNanoAiu[3]! / 1e9,
      ]);
      expect(session.costAiCredits.known).toBe(false);
    });

    it("gives an existing turn an empty inspector detail and a known session no system prompt", async () => {
      await expect(api().getTurnDetail(IDS.withTurns, 0)).resolves.toEqual({ turnIndex: 0, userMessage: [], rounds: [] });
      await expect(api().getSystemPromptText(IDS.withTurns)).rejects.toThrow(/No system-prompt artifact captured/);
    });

    it("audits a session with unknown tool calls and leaves it out of the rollup counts", async () => {
      const audit = sessionAuditSchema.parse(await api().getSessionAudit(IDS.second));

      expect(audit.totals.toolCalls).toBe(0);
      const rollup = await api().getAuditRollup();
      expect(rollup).toMatchObject({ sessionCount: 0, sessionsWithUnknownToolCalls: 2 });
      expect(rollup.totals.toolCalls).toBe(0);
    });

    it("includes the sessions in the insights dataset", async () => {
      const dataset = insightsDatasetSchema.parse(await api().getInsights());

      const vscode = dataset.providers.find((provider) => provider.id === "vscode")!;
      expect(vscode).toMatchObject({ available: true, sessionCount: 2 });
    });
  });

  describe("in the extension's MCP server", () => {
    it("lists them", async () => {
      const result = await mcp.callTool({ name: "list_sessions", arguments: {} });
      const { sessions } = result.structuredContent as { sessions: { id: string }[] };

      expect(sessions.map((session) => session.id)).toEqual([IDS.second, IDS.withTurns]);
    });

    it("explains a session's cost with its known-turn coverage", async () => {
      const result = await mcp.callTool({ name: "get_session_cost", arguments: { sessionId: IDS.withTurns } });
      const cost = sessionCostSchema.parse(result.structuredContent);

      expect(cost.totals.aiCredits).toMatchObject({ knownTurns: 4, turns: 5 });
      expect(cost.totals.aiCredits.value).toBeCloseTo(FIXTURE_AI_CREDITS, 9);
      expect(cost.totals.cacheWrite).toMatchObject({ value: null, knownTurns: 0 });
    });

    it("reads one turn", async () => {
      const result = await mcp.callTool({ name: "get_turn", arguments: { sessionId: IDS.withTurns, turnIndex: 1 } });

      expect(result.isError).toBeFalsy();
      expect(turnViewSchema.parse(result.structuredContent).turnIndex).toBe(1);
    });

    it("rolls the cost up and lists findings", async () => {
      const rollup = costRollupSchema.parse(
        (await mcp.callTool({ name: "get_cost_rollup", arguments: {} })).structuredContent,
      );
      const findings = await mcp.callTool({ name: "list_findings", arguments: {} });

      expect(rollup.totals.aiCredits.value).toBeCloseTo(2 * FIXTURE_AI_CREDITS, 9);
      expect(findings.isError).toBeFalsy();
    });
  });
});
