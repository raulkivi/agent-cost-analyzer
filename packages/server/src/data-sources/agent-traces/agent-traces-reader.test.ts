import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTempSqliteDbPath, type TempSqliteDb } from "../../test-support/temp-sqlite-db.js";
import {
  getAgentTraceUsageByResponseIds,
  loadAgentTraceUsageForResponseIds,
} from "./agent-traces-reader.js";

// Schema confirmed against a real agent-traces.db capture (Phase 8.5 doc's
// investigation) — see docs/copilot-chat-source-investigation.md §5d/§5f.
const SCHEMA = `
  CREATE TABLE spans (
    span_id TEXT PRIMARY KEY, trace_id TEXT NOT NULL, parent_span_id TEXT,
    name TEXT NOT NULL, start_time_ms INTEGER NOT NULL, end_time_ms INTEGER NOT NULL,
    status_code INTEGER NOT NULL DEFAULT 0, status_message TEXT,
    operation_name TEXT, provider_name TEXT, agent_name TEXT, conversation_id TEXT,
    request_model TEXT, response_model TEXT,
    input_tokens INTEGER, output_tokens INTEGER, cached_tokens INTEGER, reasoning_tokens INTEGER,
    tool_name TEXT, tool_call_id TEXT, tool_type TEXT,
    chat_session_id TEXT, turn_index INTEGER, ttft_ms REAL
  );
  CREATE TABLE span_attributes (
    span_id TEXT NOT NULL REFERENCES spans(span_id) ON DELETE CASCADE,
    key TEXT NOT NULL, value TEXT, PRIMARY KEY (span_id, key)
  );
`;

function seedSpan(
  db: DatabaseSync,
  spanId: string,
  options: { reasoningTokens?: number | null; responseId: string; cacheWrite?: number | null },
): void {
  db.prepare(
    `INSERT INTO spans (span_id, trace_id, name, start_time_ms, end_time_ms, operation_name, reasoning_tokens)
     VALUES (?, ?, 'chat', 0, 1, 'chat', ?)`,
  ).run(spanId, `trace-${spanId}`, options.reasoningTokens ?? null);

  db.prepare(`INSERT INTO span_attributes (span_id, key, value) VALUES (?, 'gen_ai.response.id', ?)`).run(
    spanId,
    options.responseId,
  );

  if (options.cacheWrite !== undefined && options.cacheWrite !== null) {
    db.prepare(
      `INSERT INTO span_attributes (span_id, key, value) VALUES (?, 'gen_ai.usage.cache_creation.input_tokens', ?)`,
    ).run(spanId, String(options.cacheWrite));
  }
}

describe("getAgentTraceUsageByResponseIds", () => {
  let temp: TempSqliteDb;
  let db: DatabaseSync;

  beforeEach(() => {
    temp = createTempSqliteDbPath("agent-traces-reader-test");
    db = new DatabaseSync(temp.dbFile);
    db.exec(SCHEMA);
  });

  afterEach(() => {
    db.close();
    temp.cleanup();
  });

  it("returns cacheWrite and reasoning for a matching responseId", () => {
    seedSpan(db, "span-a", { responseId: "resp-a", reasoningTokens: 1656, cacheWrite: 16860 });

    const result = getAgentTraceUsageByResponseIds(db, ["resp-a"]);

    expect(result.get("resp-a")).toEqual({ cacheWrite: 16860, reasoning: 1656 });
  });

  it("returns an empty map immediately for an empty responseIds list, without querying", () => {
    expect(getAgentTraceUsageByResponseIds(db, [])).toEqual(new Map());
  });

  it("has no entry for a responseId with no matching span (setting enabled after this session ran)", () => {
    seedSpan(db, "span-a", { responseId: "resp-a", reasoningTokens: 100, cacheWrite: 500 });

    const result = getAgentTraceUsageByResponseIds(db, ["resp-does-not-exist"]);

    expect(result.has("resp-does-not-exist")).toBe(false);
  });

  it("treats an absent cache-creation attribute as a legitimate 0, not unavailable", () => {
    seedSpan(db, "span-a", { responseId: "resp-a", reasoningTokens: 42 });

    const result = getAgentTraceUsageByResponseIds(db, ["resp-a"]);

    expect(result.get("resp-a")).toEqual({ cacheWrite: 0, reasoning: 42 });
  });

  it("treats a null reasoning_tokens column as a legitimate 0", () => {
    seedSpan(db, "span-a", { responseId: "resp-a", reasoningTokens: null, cacheWrite: 10 });

    const result = getAgentTraceUsageByResponseIds(db, ["resp-a"]);

    expect(result.get("resp-a")).toEqual({ cacheWrite: 10, reasoning: 0 });
  });

  it("resolves multiple responseIds in one query", () => {
    seedSpan(db, "span-a", { responseId: "resp-a", reasoningTokens: 1, cacheWrite: 10 });
    seedSpan(db, "span-b", { responseId: "resp-b", reasoningTokens: 2, cacheWrite: 20 });

    const result = getAgentTraceUsageByResponseIds(db, ["resp-a", "resp-b"]);

    expect(result.get("resp-a")).toEqual({ cacheWrite: 10, reasoning: 1 });
    expect(result.get("resp-b")).toEqual({ cacheWrite: 20, reasoning: 2 });
  });

  it("ignores non-chat operation spans even if they carry a matching response id attribute", () => {
    db.prepare(
      `INSERT INTO spans (span_id, trace_id, name, start_time_ms, end_time_ms, operation_name)
       VALUES ('span-tool', 'trace-tool', 'execute_tool', 0, 1, 'execute_tool')`,
    ).run();
    db.prepare(
      `INSERT INTO span_attributes (span_id, key, value) VALUES ('span-tool', 'gen_ai.response.id', 'resp-a')`,
    ).run();

    expect(getAgentTraceUsageByResponseIds(db, ["resp-a"]).has("resp-a")).toBe(false);
  });
});

describe("loadAgentTraceUsageForResponseIds", () => {
  let temp: TempSqliteDb;

  beforeEach(() => {
    temp = createTempSqliteDbPath("agent-traces-reader-load-test");
  });

  afterEach(() => {
    temp.cleanup();
  });

  it("returns an empty map without touching the filesystem when dbPath is null", () => {
    expect(loadAgentTraceUsageForResponseIds(null, ["resp-a"])).toEqual(new Map());
  });

  it("opens, queries, and closes a real db file end to end", () => {
    const db = new DatabaseSync(temp.dbFile);
    db.exec(SCHEMA);
    seedSpan(db, "span-a", { responseId: "resp-a", reasoningTokens: 5, cacheWrite: 50 });
    db.close();

    const result = loadAgentTraceUsageForResponseIds(temp.dbFile, ["resp-a"]);

    expect(result.get("resp-a")).toEqual({ cacheWrite: 50, reasoning: 5 });
  });

  it("degrades to an empty map, not a throw, when the db file is corrupt/unreadable", () => {
    // A non-SQLite file at the resolved path (corrupt DB, mid-write, etc.) —
    // this data source is explicitly optional, so it must never fail the
    // whole /api/sessions/:id request.
    writeFileSync(temp.dbFile, "not a sqlite file");

    expect(loadAgentTraceUsageForResponseIds(temp.dbFile, ["resp-a"])).toEqual(new Map());
  });
});
