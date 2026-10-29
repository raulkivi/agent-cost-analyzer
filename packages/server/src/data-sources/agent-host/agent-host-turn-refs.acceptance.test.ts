import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openReadOnlyDb } from "../sqlite/session-store.js";
import { readAgentHostSdkSessionId } from "./agent-host-catalog.js";
import { readAgentHostTurnEventIds } from "./agent-session-store.js";

const FIXTURES = new URL("../../../fixtures/agent-host/", import.meta.url);
const hostSchema = readFileSync(new URL("agent-host.schema.sql", FIXTURES), "utf8");
const sessionSchema = readFileSync(new URL("session.schema.sql", FIXTURES), "utf8");
const rows = JSON.parse(readFileSync(new URL("copilot-cli/rows.json", FIXTURES), "utf8")) as {
  sdkSessionIds: Record<string, string>;
  chats_v2: { chat_uri: string; owner_session_uri: string; chat_order: number | null; provider_data: string | null; metadata: string; metadata_hash: string }[];
  turns: Record<string, { id: string; event_id: string | null; checkpoint_ref: string }[]>;
};
const SESSION = (n: number) => `copilotcli:/9a1b2c3d-5555-4e6f-8a07-00000000000${n}`;

let dir: string;
const open: DatabaseSync[] = [];
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "turn-refs-"));
});
afterEach(() => {
  for (const db of open.splice(0)) db.close();
  rmSync(dir, { recursive: true, force: true });
});

function build(schema: string, seed: (db: DatabaseSync) => void): DatabaseSync {
  const file = path.join(dir, `db-${open.length}.db`);
  const w = new DatabaseSync(file);
  w.exec("PRAGMA foreign_keys = OFF;");
  w.exec(schema);
  seed(w);
  w.close();
  const db = openReadOnlyDb(file);
  open.push(db);
  return db;
}

function hostFromFixture(): DatabaseSync {
  return build(hostSchema, (db) => {
    const ins = db.prepare(
      "INSERT INTO chats_v2 (chat_uri, owner_session_uri, chat_order, provider_data, metadata, metadata_hash) VALUES (?,?,?,?,?,?)",
    );
    for (const r of rows.chats_v2) ins.run(r.chat_uri, r.owner_session_uri, r.chat_order, r.provider_data, r.metadata, r.metadata_hash);
  });
}

describe("readAgentHostSdkSessionId", () => {
  it("returns the sdkSessionId of the session's chat (fixture sessions 1-5)", () => {
    const db = hostFromFixture();
    expect(readAgentHostSdkSessionId(db, SESSION(1))).toBe(rows.sdkSessionIds.normal);
    expect(readAgentHostSdkSessionId(db, SESSION(2))).toBe(rows.sdkSessionIds.steeringAbortSubagent);
    expect(readAgentHostSdkSessionId(db, SESSION(3))).toBe(rows.sdkSessionIds.systemPromptReemit);
    expect(readAgentHostSdkSessionId(db, SESSION(4))).toBe(rows.sdkSessionIds.malformed);
    expect(readAgentHostSdkSessionId(db, SESSION(5))).toBe(rows.sdkSessionIds.missingLog);
  });

  it("skips rows with NULL, non-JSON, array, missing or empty sdkSessionId (session 6)", () => {
    expect(readAgentHostSdkSessionId(hostFromFixture(), SESSION(6))).toBe("5d1a0006-aaaa-4bbb-8ccc-000000000006");
  });

  it("orders by chat_order with NULL last (session 7)", () => {
    expect(readAgentHostSdkSessionId(hostFromFixture(), SESSION(7))).toBe("5d1a0007-aaaa-4bbb-8ccc-0000000000a1");
  });

  it("is null for a session with no chat row", () => {
    expect(readAgentHostSdkSessionId(hostFromFixture(), SESSION(9))).toBeNull();
  });

  it("is null without a chats_v2 table", () => {
    const db = build("CREATE TABLE metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)", () => {});
    expect(readAgentHostSdkSessionId(db, SESSION(1))).toBeNull();
  });

  it("falls back on insertion order (rowid) when chat_order ties", () => {
    const db = build(hostSchema, (w) => {
      const ins = w.prepare("INSERT INTO chats_v2 (chat_uri, owner_session_uri, chat_order, provider_data, metadata, metadata_hash) VALUES (?,?,?,?,?,?)");
      ins.run("c-z", SESSION(1), 0, JSON.stringify({ sdkSessionId: "first" }), "{}", "h");
      ins.run("c-a", SESSION(1), 0, JSON.stringify({ sdkSessionId: "second" }), "{}", "h");
    });
    expect(readAgentHostSdkSessionId(db, SESSION(1))).toBe("first");
  });

  it("ignores other sessions' chats and non-string ids", () => {
    const db = build(hostSchema, (w) => {
      const ins = w.prepare("INSERT INTO chats_v2 (chat_uri, owner_session_uri, chat_order, provider_data, metadata, metadata_hash) VALUES (?,?,?,?,?,?)");
      ins.run("c1", SESSION(2), 0, JSON.stringify({ sdkSessionId: "other" }), "{}", "h");
      ins.run("c2", SESSION(1), 0, JSON.stringify({ sdkSessionId: 42 }), "{}", "h");
      ins.run("c3", SESSION(1), 1, "null", "{}", "h");
    });
    expect(readAgentHostSdkSessionId(db, SESSION(1))).toBeNull();
  });
});

function sessionDbWith(turns: { id: string; event_id: string | null }[]): DatabaseSync {
  return build(sessionSchema, (db) => {
    const ins = db.prepare("INSERT INTO turns (id, event_id, checkpoint_ref) VALUES (?,?,?)");
    for (const t of turns) ins.run(t.id, t.event_id, null);
  });
}

describe("readAgentHostTurnEventIds", () => {
  it("returns every turn in rowid order with its event id (steering/abort/duplicate fixture)", () => {
    const fx = rows.turns.steeringAbortSubagent!;
    const refs = readAgentHostTurnEventIds(sessionDbWith(fx));
    expect(refs).toEqual(fx.map((t) => ({ turnId: t.id, eventId: t.event_id })));
    expect(refs).toHaveLength(5);
    // the aborted-turn duplicate: bare id, NULL event id, bare id equals the previous row's event id
    expect(refs[4]).toEqual({ turnId: refs[3]!.eventId, eventId: null });
  });

  it("is in rowid (insertion) order, not id order", () => {
    const refs = readAgentHostTurnEventIds(
      sessionDbWith([
        { id: "request_z", event_id: "e1" },
        { id: "request_a", event_id: "e2" },
      ]),
    );
    expect(refs.map((r) => r.turnId)).toEqual(["request_z", "request_a"]);
  });

  it("maps NULL and empty event_id to null", () => {
    const refs = readAgentHostTurnEventIds(
      sessionDbWith([
        { id: "t1", event_id: null },
        { id: "t2", event_id: "" },
        { id: "t3", event_id: "ev" },
      ]),
    );
    expect(refs).toEqual([
      { turnId: "t1", eventId: null },
      { turnId: "t2", eventId: null },
      { turnId: "t3", eventId: "ev" },
    ]);
  });

  it("is empty for a turns table with no rows", () => {
    expect(readAgentHostTurnEventIds(sessionDbWith([]))).toEqual([]);
  });

  it("is [] without a turns table", () => {
    const db = build("CREATE TABLE session_metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)", () => {});
    expect(readAgentHostTurnEventIds(db)).toEqual([]);
  });

  it("gives null event ids when the turns table has no event_id column", () => {
    const db = build("CREATE TABLE turns (id TEXT PRIMARY KEY NOT NULL)", (w) => {
      w.prepare("INSERT INTO turns (id) VALUES (?)").run("request_1");
      w.prepare("INSERT INTO turns (id) VALUES (?)").run("request_2");
    });
    expect(readAgentHostTurnEventIds(db)).toEqual([
      { turnId: "request_1", eventId: null },
      { turnId: "request_2", eventId: null },
    ]);
  });
});
