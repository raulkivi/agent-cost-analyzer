// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { seedCopilotSessionStore } from "@agent-cost-analyzer/server/src/test-support/copilot-session-store";
import { FIXTURE_VENDOR_PROFILES_DIR } from "@agent-cost-analyzer/server/src/test-support/vendor-profiles-dir";
import { createCopilotMcpServer } from "../../../../src/mcp/copilot-mcp-server.js";
import { clearChatHistory, HISTORY_REPLAY_MODELS, HISTORY_REPOSITORIES, seedChatHistory } from "./chat-history-seed.mts";

// The made-up chat history the G4 view specs read (step 10.17): sessions in
// two repositories over several weeks, with known AI Credits, seeded into
// the run's profile copy. Checked here through the extension's own MCP
// server, the one the real chat calls.
const NOW = new Date("2026-11-11T12:00:00.000Z");

describe("seedChatHistory", () => {
  let rootDir: string;
  let client: Client | undefined;
  afterEach(async () => {
    await client?.close();
    client = undefined;
    rmSync(rootDir, { recursive: true, force: true });
  });

  async function serverOver(userDataDir: string, copilotHome: string): Promise<Client> {
    const server = createCopilotMcpServer({ userDataDir, version: "0.0.0-test", vendorProfilesDir: FIXTURE_VENDOR_PROFILES_DIR, copilotHome });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return client;
  }

  async function call<T>(mcp: Client, name: string, args: Record<string, unknown>): Promise<T> {
    const result = await mcp.callTool({ name, arguments: args });
    if (result.isError === true) throw new Error(`${name}: ${JSON.stringify(result.content)}`);
    return result.structuredContent as T;
  }

  function seeded(options: { existingStore: boolean }) {
    rootDir = mkdtempSync(path.join(tmpdir(), "aica-g4-"));
    const userDataDir = path.join(rootDir, "settings");
    const copilotHome = path.join(rootDir, "copilot-home");
    mkdirSync(copilotHome, { recursive: true });
    // A profile Copilot Chat already used has its own store; a new one has none.
    if (options.existingStore) seedCopilotSessionStore(path.join(userDataDir, "User", "globalStorage", "github.copilot-chat", "session-store.db"), NOW.toISOString(), null);
    const history = seedChatHistory({ userDataDir, reposDir: path.join(rootDir, "repos"), now: NOW });
    return { userDataDir, copilotHome, history };
  }

  it("lists both repositories, with known AI Credits", async () => {
    const { userDataDir, copilotHome } = seeded({ existingStore: false });
    const mcp = await serverOver(userDataDir, copilotHome);

    const { repositories } = await call<{ repositories: { key: string }[] }>(mcp, "list_repositories", {});

    expect(repositories.map((repository) => repository.key)).toEqual(expect.arrayContaining([HISTORY_REPOSITORIES.portal.key, HISTORY_REPOSITORIES.billing.key]));
  });

  // VS Code's shared process deletes, 30 s after start-up, every
  // workspaceStorage folder whose name isn't 32 characters long (a folder
  // workspace's id) and that no window uses; a second launch on the same copy
  // then finds no debug logs.
  it("keeps the debug logs in a workspace-storage folder VS Code's clean-up leaves alone", () => {
    const { userDataDir } = seeded({ existingStore: false });

    const folders = readdirSync(path.join(userDataDir, "User", "workspaceStorage"));
    expect(folders).toHaveLength(1);
    expect(folders[0]).toMatch(/^[0-9a-f]{32}$/);
  });

  it("adds to a session store Copilot Chat already has, keeping its rows", async () => {
    const { userDataDir, copilotHome, history } = seeded({ existingStore: true });
    const mcp = await serverOver(userDataDir, copilotHome);

    const { sessions } = await call<{ sessions: { id: string }[] }>(mcp, "list_sessions", { limit: 50 });

    expect(sessions).toHaveLength(history.sessionIds.length + 1);
  });

  it("spreads the first repository's cost over at least four weeks of the last 90 days", async () => {
    const { userDataDir, copilotHome, history } = seeded({ existingStore: false });
    const mcp = await serverOver(userDataDir, copilotHome);

    const series = await call<{ points: { turns: number }[]; totals: { preferred: { knownTurns: number; turns: number } } }>(mcp, "get_repository_cost", {
      repository: HISTORY_REPOSITORIES.portal.key,
      bucket: "week",
      since: history.periods.last90Days.since,
      until: history.periods.last90Days.until,
    });

    expect(series.points.filter((point) => point.turns > 0).length).toBeGreaterThanOrEqual(4);
  });

  it("gives both repositories a cost in the comparison period and the one before", async () => {
    const { userDataDir, copilotHome, history } = seeded({ existingStore: false });
    const mcp = await serverOver(userDataDir, copilotHome);

    const comparison = await call<{ rows: { key: string; previous: { total: { knownTurns: number } } }[] }>(mcp, "compare_costs", {
      groupBy: "repository",
      ids: [HISTORY_REPOSITORIES.portal.key, HISTORY_REPOSITORIES.billing.key],
      ...history.periods.comparison,
    });

    expect(comparison.rows.map((row) => row.key)).toEqual([HISTORY_REPOSITORIES.portal.key, HISTORY_REPOSITORIES.billing.key]);
    expect(comparison.rows.every((row) => row.previous.total.knownTurns > 0)).toBe(true);
  });

  // Copilot's debug log has no cache-write count, so no turn is priced: U11
  // shows its "Not explained" state, never 0 (the waterfall is G5's).
  it("has turns in both periods of the cost change, more in the later one, none priced", async () => {
    const { userDataDir, copilotHome, history } = seeded({ existingStore: false });
    const mcp = await serverOver(userDataDir, copilotHome);

    const change = await call<{ currencies: unknown[]; notExplained: { periodA: { turns: number }; periodB: { turns: number } } }>(mcp, "explain_cost_change", {
      groupBy: "repository",
      id: HISTORY_REPOSITORIES.portal.key,
      ...history.periods.change,
    });

    expect(change.notExplained.periodA.turns).toBeGreaterThan(0);
    expect(change.notExplained.periodB.turns).toBeGreaterThan(change.notExplained.periodA.turns);
    expect(change.currencies).toEqual([]);
  });

  it("names a session with known AI Credits for the session view", async () => {
    const { userDataDir, copilotHome, history } = seeded({ existingStore: false });
    const mcp = await serverOver(userDataDir, copilotHome);

    const cost = await call<{ totals: { aiCredits: { value: number | null } } }>(mcp, "get_session_cost", { sessionId: history.sessionIds[0] });

    expect(cost.totals.aiCredits.value).toBeGreaterThan(0);
  });

  // A33 (Increment 3 views in G4): U12 replays a seeded session. Copilot's
  // prices start on 2026-10-01, so each debug log is dated at its session's
  // start (the fixture log is from August, when no Copilot price is known).
  it("dates each session's debug log at the session's start", async () => {
    const { userDataDir, copilotHome, history } = seeded({ existingStore: false });
    const mcp = await serverOver(userDataDir, copilotHome);

    const { sessions } = await call<{ sessions: { id: string; startedAt: string }[] }>(mcp, "list_sessions", { limit: 50 });
    const newest = sessions.find((session) => session.id === history.sessionIds[0])!;
    const replay = await call<{ pricing: { asOf: string } }>(mcp, "replay_session", { sessionId: newest.id, model: HISTORY_REPLAY_MODELS[0] });

    expect(replay.pricing.asOf).toBe(newest.startedAt.slice(0, 10));
  });

  // U5 names each row's Analyse button by the id's first 8 characters.
  it("gives every session its own short id", () => {
    const { history } = seeded({ existingStore: false });

    expect(new Set(history.sessionIds.map((id) => id.slice(0, 8))).size).toBe(history.sessionIds.length);
  });

  it("replays the newest session on its own model and the compared models with a price", async () => {
    const { userDataDir, copilotHome, history } = seeded({ existingStore: false });
    const mcp = await serverOver(userDataDir, copilotHome);

    const comparison = await call<{ measured: { value: number | null }; entries: { model: string; total: { value: number | null }; isMeasuredModel: boolean }[] }>(
      mcp,
      "compare_models_for_session",
      { sessionId: history.sessionIds[0], models: [...HISTORY_REPLAY_MODELS] },
    );

    expect(comparison.measured.value).toBeGreaterThan(0);
    expect(comparison.entries.map((entry) => entry.model)).toEqual([expect.any(String), ...HISTORY_REPLAY_MODELS]);
    expect(comparison.entries[0]!.isMeasuredModel).toBe(true);
    expect(comparison.entries.every((entry) => entry.total.value !== null && entry.total.value > 0)).toBe(true);
  });

  it("gives the audit views tool calls in every session, with outcomes Copilot doesn't record", async () => {
    const { userDataDir, copilotHome, history } = seeded({ existingStore: false });
    const mcp = await serverOver(userDataDir, copilotHome);

    const audit = await call<{ totals: { toolCalls: number; unknown: number } }>(mcp, "get_session_audit", { sessionId: history.sessionIds[0] });
    const rollup = await call<{ sessionCount: number; daily: unknown[] }>(mcp, "get_audit_rollup", { since: history.periods.last90Days.since });

    expect(audit.totals.toolCalls).toBeGreaterThan(0);
    expect(audit.totals.unknown).toBe(audit.totals.toolCalls);
    expect(rollup.sessionCount).toBe(history.sessionIds.length);
    expect(rollup.daily.length).toBeGreaterThanOrEqual(4);
  });

  it("has documented price changes in the last 90 days for the price-changes view", async () => {
    const { userDataDir, copilotHome, history } = seeded({ existingStore: false });
    const mcp = await serverOver(userDataDir, copilotHome);

    const { changes } = await call<{ changes: { kind: string }[] }>(mcp, "get_price_changes", { ...history.periods.last90Days });

    expect(changes.some((change) => change.kind === "documented")).toBe(true);
  });
});

// The owner's test profile can hold chats from its sign-in or other use
// (Agent Host sessions, an empty-window chat, Copilot Chat's store); the copy
// drops them before seeding, so only made-up sessions and the run's own chats
// reach a view. The sign-in (Local State, global state) stays.
describe("clearChatHistory", () => {
  let rootDir: string;
  afterEach(() => rmSync(rootDir, { recursive: true, force: true }));

  it("removes earlier chats from the copy and keeps the sign-in and the store's schema", async () => {
    rootDir = mkdtempSync(path.join(tmpdir(), "aica-g4-"));
    const userDataDir = path.join(rootDir, "settings");
    const globalStorage = path.join(userDataDir, "User", "globalStorage");
    const storePath = path.join(globalStorage, "github.copilot-chat", "session-store.db");
    seedCopilotSessionStore(storePath, NOW.toISOString());
    mkdirSync(path.join(globalStorage, "emptyWindowChatSessions"), { recursive: true });
    writeFileSync(path.join(globalStorage, "emptyWindowChatSessions", "a.jsonl"), "{}");
    for (const file of ["agent-host.db", "agent-host.db-wal", "state.vscdb"]) writeFileSync(path.join(globalStorage, file), "x");
    writeFileSync(path.join(userDataDir, "Local State"), "{}");

    clearChatHistory(userDataDir);

    expect(existsSync(path.join(globalStorage, "agent-host.db"))).toBe(false);
    expect(existsSync(path.join(globalStorage, "agent-host.db-wal"))).toBe(false);
    expect(existsSync(path.join(globalStorage, "emptyWindowChatSessions", "a.jsonl"))).toBe(false);
    expect(existsSync(path.join(globalStorage, "state.vscdb"))).toBe(true);
    expect(existsSync(path.join(userDataDir, "Local State"))).toBe(true);
    const mcp = createCopilotMcpServer({ userDataDir, version: "0.0.0-test", vendorProfilesDir: FIXTURE_VENDOR_PROFILES_DIR, copilotHome: path.join(rootDir, "none") });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1.0.0" });
    await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.callTool({ name: "list_sessions", arguments: {} });
    await client.close();
    expect((result.structuredContent as { sessions: unknown[] }).sessions).toEqual([]);
  });

  it("does nothing to a profile with no chats", () => {
    rootDir = mkdtempSync(path.join(tmpdir(), "aica-g4-"));

    expect(() => clearChatHistory(path.join(rootDir, "settings"))).not.toThrow();
  });
});
