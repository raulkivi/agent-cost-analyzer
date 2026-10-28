import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Session } from "@agent-cost-analyzer/domain";
import { AgentHostSessionSource } from "../../agent-host/agent-host-session-source.js";
import {
  AGENT_HOST_FIXTURE_SESSION_IDS as AGENT_HOST_IDS,
  writeAgentHostCatalog,
  writeAgentSessionDb,
} from "../../../test-support/agent-host-user-data-dir.js";
import { describeLogProviderContract } from "../contract.js";
import type { SystemPromptTextLookup } from "../system-prompt-text-reader.js";
import type { CopilotSessionSource } from "./copilot-session-source.js";
import { VscodeLogProvider } from "./vscode-log-provider.js";

const SESSION_STORE_SCHEMA = `
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY, cwd TEXT, repository TEXT, branch TEXT, host_type TEXT,
    summary TEXT, agent_name TEXT, agent_description TEXT, created_at TEXT, updated_at TEXT
  );
  CREATE TABLE turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, turn_index INTEGER NOT NULL,
    user_message TEXT, assistant_response TEXT, timestamp TEXT
  );
  CREATE TABLE checkpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, checkpoint_number INTEGER NOT NULL,
    title TEXT, overview TEXT, history TEXT, work_done TEXT, technical_details TEXT,
    important_files TEXT, next_steps TEXT, created_at TEXT
  );
  CREATE TABLE session_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, file_path TEXT NOT NULL,
    tool_name TEXT, turn_index INTEGER, first_seen_at TEXT
  );
`;

function seedFixtureDb(dbPath: string): void {
  const db = new DatabaseSync(dbPath);
  db.exec(SESSION_STORE_SCHEMA);
  db.exec(`
    INSERT INTO sessions (id, cwd, repository, branch, host_type, summary, agent_name, agent_description, created_at, updated_at)
    VALUES ('session-1', '/repo', 'org/repo', 'main', 'desktop', 'Fix the bug', 'GitHub Copilot Chat', 'chat', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
    INSERT INTO turns (session_id, turn_index, user_message, assistant_response, timestamp)
    VALUES ('session-1', 0, 'hi', 'hello', '2026-01-01T00:00:00.000Z');
  `);
  db.close();
}

describe("VscodeLogProvider", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "vscode-log-provider-"));
    dbPath = path.join(dir, "session-store.db");
    seedFixtureDb(dbPath);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("tags every returned session with providerId: 'vscode'", async () => {
    const provider = new VscodeLogProvider({
      sessionStoreDbPath: dbPath,
      debugLogsDirPaths: [],
      agentTracesDbPath: null,
    });

    const [summary] = await provider.listSessions();
    const full = await provider.readSession("session-1");

    expect(summary.providerId).toBe("vscode");
    expect(full?.providerId).toBe("vscode");
  });

  it("returns null from readSession for an id the store doesn't have", async () => {
    const provider = new VscodeLogProvider({
      sessionStoreDbPath: dbPath,
      debugLogsDirPaths: [],
      agentTracesDbPath: null,
    });

    await expect(provider.readSession("does-not-exist")).resolves.toBeNull();
  });

  it("populates real cacheWrite/reasoning from agent-traces.db, folded into this provider (Phase 8.5)", async () => {
    const debugLogsDirPath = path.join(dir, "debug-logs");
    const sessionLogDir = path.join(debugLogsDirPath, "session-1");
    mkdirSync(sessionLogDir, { recursive: true });
    const lines = [
      { v: 1, ts: 1, dur: 0, sid: "session-1", type: "user_message", name: "user_message", spanId: "u0", status: "ok", attrs: { content: "hi" } },
      {
        v: 1, ts: 2, dur: 5, sid: "session-1", type: "llm_request", name: "llm_request", spanId: "b", status: "ok",
        attrs: { model: "claude-sonnet-5", inputTokens: 1000, outputTokens: 50, cachedTokens: 200, responseId: "resp-a" },
      },
    ];
    writeFileSync(
      path.join(sessionLogDir, "main.jsonl"),
      lines.map((line) => JSON.stringify(line)).join("\n") + "\n",
    );
    const agentTracesDbPath = path.join(dir, "agent-traces.db");
    const tracesDb = new DatabaseSync(agentTracesDbPath);
    tracesDb.exec(`
      CREATE TABLE spans (span_id TEXT PRIMARY KEY, operation_name TEXT, reasoning_tokens INTEGER);
      CREATE TABLE span_attributes (span_id TEXT, key TEXT, value TEXT);
    `);
    tracesDb
      .prepare("INSERT INTO spans (span_id, operation_name, reasoning_tokens) VALUES ('span-a', 'chat', 119)")
      .run();
    tracesDb
      .prepare("INSERT INTO span_attributes (span_id, key, value) VALUES ('span-a', 'gen_ai.response.id', 'resp-a')")
      .run();
    tracesDb
      .prepare(
        "INSERT INTO span_attributes (span_id, key, value) VALUES ('span-a', 'gen_ai.usage.cache_creation.input_tokens', '16860')",
      )
      .run();
    tracesDb.close();

    const provider = new VscodeLogProvider({
      sessionStoreDbPath: dbPath,
      debugLogsDirPaths: [debugLogsDirPath],
      agentTracesDbPath,
    });

    const session = await provider.readSession("session-1");

    expect(session?.turns[0].usage.cacheWrite).toEqual({ known: true, value: 16860 });
    expect(session?.turns[0].usage.reasoning).toEqual({ known: true, value: 119 });
  });
});

function seedRoundTripLog(debugLogsDirPath: string, sessionId: string): void {
  const sessionLogDir = path.join(debugLogsDirPath, sessionId);
  mkdirSync(sessionLogDir, { recursive: true });
  const lines = [
    { type: "user_message", attrs: { content: "hi" } },
    { type: "llm_request", attrs: { inputMessages: [{ role: "system", content: "You are an agent." }] } },
    { type: "agent_response", attrs: { response: "hello" } },
  ];
  writeFileSync(
    path.join(sessionLogDir, "main.jsonl"),
    lines.map((line) => JSON.stringify(line)).join("\n") + "\n",
  );
}

describeLogProviderContract("VscodeLogProvider", {
  buildAvailableProvider: () => {
    const dir = mkdtempSync(path.join(tmpdir(), "vscode-log-provider-contract-"));
    const dbPath = path.join(dir, "session-store.db");
    seedFixtureDb(dbPath);
    const debugLogsDirPath = path.join(dir, "debug-logs");
    seedRoundTripLog(debugLogsDirPath, "session-1");
    return new VscodeLogProvider({
      sessionStoreDbPath: dbPath,
      debugLogsDirPaths: [debugLogsDirPath],
      agentTracesDbPath: null,
    });
  },
  knownSessionId: "session-1",
  unknownSessionId: "does-not-exist",
  buildUnavailableProvider: () =>
    new VscodeLogProvider({
      sessionStoreDbPath: null,
      debugLogsDirPaths: [],
      agentTracesDbPath: null,
    }),
  turnIndexWithRoundTrip: 0,
});

describe("VscodeLogProvider.readTurnDetail", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "vscode-log-provider-turn-detail-"));
    dbPath = path.join(dir, "session-store.db");
    seedFixtureDb(dbPath);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns real round-trip content for a turn captured in main.jsonl", async () => {
    const debugLogsDirPath = path.join(dir, "debug-logs");
    seedRoundTripLog(debugLogsDirPath, "session-1");
    const provider = new VscodeLogProvider({
      sessionStoreDbPath: dbPath,
      debugLogsDirPaths: [debugLogsDirPath],
      agentTracesDbPath: null,
    });

    const detail = await provider.readTurnDetail("session-1", 0);

    expect(detail).not.toBeNull();
    expect(detail!.userMessage).toEqual([{ kind: "text", text: "hi" }]);
    expect(detail!.rounds).toHaveLength(1);
    expect(detail!.rounds[0].response.response).toEqual([{ kind: "text", text: "hello" }]);
  });

  it("returns null for a turnIndex beyond this session's SQLite turn count", async () => {
    const provider = new VscodeLogProvider({
      sessionStoreDbPath: dbPath,
      debugLogsDirPaths: [],
      agentTracesDbPath: null,
    });

    await expect(provider.readTurnDetail("session-1", 5)).resolves.toBeNull();
  });

  it("returns an empty-rounds detail (not null) when the turn exists in SQLite but main.jsonl has no coverage at all", async () => {
    const provider = new VscodeLogProvider({
      sessionStoreDbPath: dbPath,
      debugLogsDirPaths: [],
      agentTracesDbPath: null,
    });

    const detail = await provider.readTurnDetail("session-1", 0);

    expect(detail).not.toBeNull();
    expect(detail!.rounds).toEqual([]);
  });

  it("returns an empty-rounds detail (not null) when main.jsonl exists but never reached this turn's user_message", async () => {
    const debugLogsDirPath = path.join(dir, "debug-logs");
    const sessionLogDir = path.join(debugLogsDirPath, "session-1");
    mkdirSync(sessionLogDir, { recursive: true });
    writeFileSync(
      path.join(sessionLogDir, "main.jsonl"),
      JSON.stringify({ type: "session_start", attrs: {} }) + "\n",
    );
    const provider = new VscodeLogProvider({
      sessionStoreDbPath: dbPath,
      debugLogsDirPaths: [debugLogsDirPath],
      agentTracesDbPath: null,
    });

    const detail = await provider.readTurnDetail("session-1", 0);

    expect(detail).not.toBeNull();
    expect(detail!.rounds).toEqual([]);
  });
});

// The SystemPromptTextReader capability (vscode-extension.md G1): the
// main.jsonl system-prompt artifact behind GET /api/sessions/:id/system-prompt,
// moved here from app.ts.
describe("VscodeLogProvider.lookupSystemPromptText", () => {
  let dir: string;
  let dbPath: string;
  let debugLogsDirPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "vscode-log-provider-system-prompt-"));
    dbPath = path.join(dir, "session-store.db");
    debugLogsDirPath = path.join(dir, "debug-logs");
    seedFixtureDb(dbPath);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function provider(sessionStoreDbPath: string | null = dbPath): VscodeLogProvider {
    return new VscodeLogProvider({ sessionStoreDbPath, debugLogsDirPaths: [debugLogsDirPath], agentTracesDbPath: null });
  }

  function writeMainJsonl(lines: object[]): void {
    const sessionLogDir = path.join(debugLogsDirPath, "session-1");
    mkdirSync(sessionLogDir, { recursive: true });
    writeFileSync(path.join(sessionLogDir, "main.jsonl"), lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  }

  it("returns the raw system prompt text from the session's system_prompt artifact", async () => {
    writeMainJsonl([
      { v: 1, ts: 1, dur: 0, sid: "session-1", type: "session_start", name: "session_start", spanId: "a", status: "ok", attrs: {} },
      {
        v: 1, ts: 2, dur: 5, sid: "session-1", type: "llm_request", name: "llm_request", spanId: "b", status: "ok",
        attrs: { model: "claude-sonnet-5", systemPromptFile: "system_prompt_0.json", toolsFile: "tools_0.json" },
      },
    ]);
    writeFileSync(
      path.join(debugLogsDirPath, "session-1", "system_prompt_0.json"),
      JSON.stringify({ content: JSON.stringify([{ type: "text", content: "You are a helpful assistant." }]) }),
    );

    await expect(provider().lookupSystemPromptText("session-1")).resolves.toEqual({
      status: "found",
      text: "You are a helpful assistant.",
    });
  });

  it("reports not-captured for a known session whose main.jsonl has no system-prompt artifact", async () => {
    writeMainJsonl([
      { v: 1, ts: 1, dur: 0, sid: "session-1", type: "session_start", name: "session_start", spanId: "a", status: "ok", attrs: {} },
    ]);

    await expect(provider().lookupSystemPromptText("session-1")).resolves.toEqual({ status: "not-captured" });
  });

  it("reports not-captured for a known session with no main.jsonl at all", async () => {
    await expect(provider().lookupSystemPromptText("session-1")).resolves.toEqual({ status: "not-captured" });
  });

  it("reports unknown-session for an id the store doesn't have", async () => {
    await expect(provider().lookupSystemPromptText("does-not-exist")).resolves.toEqual({ status: "unknown-session" });
  });

  it("reports unknown-session when there is no session store at all", async () => {
    await expect(provider(null).lookupSystemPromptText("session-1")).resolves.toEqual({ status: "unknown-session" });
  });
});

// The extension lists the per-workspace debug-logs folders again on Refresh
// (vscode-extension.md 10.6), so the provider accepts a lister and asks it
// each time it looks a session's main.jsonl up.
describe("VscodeLogProvider with a debug-logs lister", () => {
  let dir: string;
  let debugLogsDirPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "vscode-log-provider-lister-"));
    seedFixtureDb(path.join(dir, "session-store.db"));
    debugLogsDirPath = path.join(dir, "debug-logs");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("finds a session's logs in a folder the lister only returns later", async () => {
    let listed: string[] = [];
    const provider = new VscodeLogProvider({
      sessionStoreDbPath: path.join(dir, "session-store.db"),
      debugLogsDirPaths: () => listed,
      agentTracesDbPath: null,
    });
    const sessionLogDir = path.join(debugLogsDirPath, "session-1");
    mkdirSync(sessionLogDir, { recursive: true });
    writeFileSync(
      path.join(sessionLogDir, "main.jsonl"),
      [
        { v: 1, ts: 1, dur: 0, sid: "session-1", type: "session_start", name: "session_start", spanId: "a", status: "ok", attrs: {} },
        { v: 1, ts: 2, dur: 5, sid: "session-1", type: "llm_request", name: "llm_request", spanId: "b", status: "ok", attrs: { model: "claude-sonnet-5", systemPromptFile: "system_prompt_0.json", toolsFile: "tools_0.json" } },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n") + "\n",
    );
    writeFileSync(
      path.join(sessionLogDir, "system_prompt_0.json"),
      JSON.stringify({ content: JSON.stringify([{ type: "text", content: "Late prompt." }]) }),
    );
    await expect(provider.lookupSystemPromptText("session-1")).resolves.toEqual({ status: "not-captured" });

    listed = [debugLogsDirPath];

    await expect(provider.lookupSystemPromptText("session-1")).resolves.toEqual({ status: "found", text: "Late prompt." });
  });
});

// Step 10.13: the Copilot provider lists VS Code Agent Host sessions next to
// the classic session store's.
function agentHostUserDataDir(): string {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "vscode-log-provider-agent-host-"));
  writeAgentHostCatalog(userDataDir);
  writeAgentSessionDb(userDataDir, AGENT_HOST_IDS.withTurns);
  return userDataDir;
}

describeLogProviderContract("VscodeLogProvider (Agent Host sessions only)", {
  buildAvailableProvider: () =>
    new VscodeLogProvider({
      sessionStoreDbPath: null,
      debugLogsDirPaths: [],
      agentTracesDbPath: null,
      agentHostSessions: new AgentHostSessionSource({ userDataDir: agentHostUserDataDir() }),
    }),
  knownSessionId: AGENT_HOST_IDS.withTurns,
  unknownSessionId: AGENT_HOST_IDS.deleted,
  buildUnavailableProvider: () =>
    new VscodeLogProvider({
      sessionStoreDbPath: null,
      debugLogsDirPaths: [],
      agentTracesDbPath: null,
      agentHostSessions: new AgentHostSessionSource({
        userDataDir: mkdtempSync(path.join(tmpdir(), "vscode-log-provider-agent-host-empty-")),
      }),
    }),
  turnIndexWithRoundTrip: null,
});

function fakeSession(id: string, startedAt: string): Session {
  return {
    id,
    mode: "analyze",
    title: `Agent Host ${id}`,
    model: "gpt-6-luna",
    turns: [],
    turnCount: 1,
    costAiCredits: { known: true, value: 1 },
    usageDataAvailable: true,
    startedAt,
  };
}

// A second store that knows one session, recording what the provider asks.
class FakeCopilotSessionSource implements CopilotSessionSource {
  readonly calls: string[] = [];

  constructor(
    private readonly session: Session,
    private readonly available = true,
  ) {}

  async checkAvailability() {
    return this.available ? { available: true } : { available: false, unavailableReason: "no Agent Host" };
  }
  async listSessions() {
    return [this.session];
  }
  async readSession(sessionId: string) {
    this.calls.push(`readSession ${sessionId}`);
    return sessionId === this.session.id ? this.session : null;
  }
  async readTurnDetail(sessionId: string, turnIndex: number) {
    this.calls.push(`readTurnDetail ${sessionId}`);
    return sessionId === this.session.id && turnIndex === 0 ? { turnIndex, userMessage: [], rounds: [] } : null;
  }
  async lookupSystemPromptText(sessionId: string): Promise<SystemPromptTextLookup> {
    this.calls.push(`lookupSystemPromptText ${sessionId}`);
    return sessionId === this.session.id ? { status: "not-captured" } : { status: "unknown-session" };
  }
}

describe("VscodeLogProvider with a second Copilot session source", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "vscode-log-provider-second-source-"));
    dbPath = path.join(dir, "session-store.db");
    seedFixtureDb(dbPath);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function provider(source: CopilotSessionSource, sessionStoreDbPath: string | null = dbPath): VscodeLogProvider {
    return new VscodeLogProvider({ sessionStoreDbPath, debugLogsDirPaths: [], agentTracesDbPath: null, agentHostSessions: source });
  }

  it("lists both stores' sessions newest start first, every one tagged providerId 'vscode'", async () => {
    const newer = new FakeCopilotSessionSource(fakeSession("agent-host-1", "2026-10-20T00:00:00.000Z"));
    const older = new FakeCopilotSessionSource(fakeSession("agent-host-0", "2025-12-01T00:00:00.000Z"));

    expect((await provider(newer).listSessions()).map((s) => [s.id, s.providerId])).toEqual([
      ["agent-host-1", "vscode"],
      ["session-1", "vscode"],
    ]);
    expect((await provider(older).listSessions()).map((s) => s.id)).toEqual(["session-1", "agent-host-0"]);
  });

  it("lists the second store's sessions when there is no classic session store", async () => {
    const source = new FakeCopilotSessionSource(fakeSession("agent-host-1", "2026-10-20T00:00:00.000Z"));

    expect((await provider(source, null).listSessions()).map((s) => s.id)).toEqual(["agent-host-1"]);
  });

  it("reads a classic session from the classic store without asking the second store", async () => {
    const source = new FakeCopilotSessionSource(fakeSession("agent-host-1", "2026-10-20T00:00:00.000Z"));
    const built = provider(source);

    expect((await built.readSession("session-1"))?.title).toBe("Fix the bug");
    expect(await built.readTurnDetail("session-1", 0)).not.toBeNull();
    expect((await built.lookupSystemPromptText("session-1")).status).toBe("not-captured");
    expect(source.calls).toEqual([]);
  });

  it("reads any other id from the second store, tagged providerId 'vscode'", async () => {
    const source = new FakeCopilotSessionSource(fakeSession("agent-host-1", "2026-10-20T00:00:00.000Z"));
    const built = provider(source);

    expect(await built.readSession("agent-host-1")).toMatchObject({ id: "agent-host-1", providerId: "vscode" });
    await expect(built.readTurnDetail("agent-host-1", 0)).resolves.toEqual({ turnIndex: 0, userMessage: [], rounds: [] });
    await expect(built.lookupSystemPromptText("agent-host-1")).resolves.toEqual({ status: "not-captured" });
    await expect(built.readSession("neither")).resolves.toBeNull();
    await expect(built.readTurnDetail("neither", 0)).resolves.toBeNull();
    await expect(built.lookupSystemPromptText("neither")).resolves.toEqual({ status: "unknown-session" });
  });

  it("is available when only the second store exists", async () => {
    const source = new FakeCopilotSessionSource(fakeSession("agent-host-1", "2026-10-20T00:00:00.000Z"));

    await expect(provider(source, null).checkAvailability()).resolves.toEqual({ available: true });
  });

  it("keeps the classic unavailable reason when neither store exists", async () => {
    const source = new FakeCopilotSessionSource(fakeSession("agent-host-1", "2026-10-20T00:00:00.000Z"), false);

    await expect(provider(source, null).checkAvailability()).resolves.toEqual({
      available: false,
      unavailableReason: "No local GitHub Copilot Chat session store was found on this machine.",
    });
  });
});
