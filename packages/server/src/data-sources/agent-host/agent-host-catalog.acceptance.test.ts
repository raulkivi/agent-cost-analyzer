import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openReadOnlyDb } from "../sqlite/session-store.js";
import {
  AGENT_HOST_COPILOT_PROVIDER,
  getAgentHostSessionRow,
  listAgentHostSessionRows,
} from "./agent-host-catalog.js";

const FIXTURES = new URL("../../../fixtures/agent-host/", import.meta.url);
const schemaSql = readFileSync(new URL("agent-host.schema.sql", FIXTURES), "utf8");
interface SessionRowFixture {
  session_uri: string;
  provider: string;
  start_time: number;
  external: number | null;
  registration_source: string;
  session_generation: string | null;
  source_revision: number | null;
  payload_version: number | null;
  payload_hash: string | null;
  verified: number;
  payload: unknown;
  is_chat_backing: number;
  modified_time: number;
}
const fixture = JSON.parse(readFileSync(new URL("catalog-rows.json", FIXTURES), "utf8")) as {
  sessions_v2: SessionRowFixture[];
  metadata: { key: string; value: string }[];
};

const A = "3f2a9c10-1111-4a1b-8c01-aaaaaaaaaaa1";
const B = "3f2a9c10-2222-4a1b-8c02-bbbbbbbbbbb2";
const TOMB = "3f2a9c10-3333-4a1b-8c03-ccccccccccc3";
const CLAUDE = "3f2a9c10-4444-4a1b-8c04-ddddddddddd4";

let dir: string;
const open: DatabaseSync[] = [];

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "agent-host-catalog-"));
});
afterEach(() => {
  for (const db of open.splice(0)) db.close();
  rmSync(dir, { recursive: true, force: true });
});

function insertSession(db: DatabaseSync, r: Partial<SessionRowFixture> & { session_uri: string }): void {
  const payload = r.payload === undefined || r.payload === null || typeof r.payload === "string" ? r.payload ?? null : JSON.stringify(r.payload);
  db.prepare(
    "INSERT INTO sessions_v2 (session_uri, provider, start_time, external, registration_source, session_generation, source_revision, payload_version, payload_hash, verified, payload, is_chat_backing, modified_time) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    r.session_uri,
    r.provider ?? "copilotcli",
    r.start_time ?? 1,
    r.external ?? null,
    r.registration_source ?? "explicit",
    r.session_generation ?? null,
    r.source_revision ?? null,
    r.payload_version ?? null,
    r.payload_hash ?? null,
    r.verified ?? 0,
    payload as string | null,
    r.is_chat_backing ?? 0,
    r.modified_time ?? 0,
  );
}

/** Builds a DB from the real DDL; `seed` mutates it before it is reopened read-only. */
function build(seed: (db: DatabaseSync) => void, opts: { schema?: string } = {}): DatabaseSync {
  const file = path.join(dir, `agent-host-${open.length}.db`);
  const w = new DatabaseSync(file);
  w.exec(opts.schema ?? schemaSql);
  seed(w);
  w.close();
  const db = openReadOnlyDb(file);
  open.push(db);
  return db;
}

function buildFromFixture(): DatabaseSync {
  return build((db) => {
    for (const r of fixture.sessions_v2) insertSession(db, r as SessionRowFixture);
    for (const m of fixture.metadata) db.prepare("INSERT INTO metadata (key, value) VALUES (?,?)").run(m.key, m.value);
  });
}

describe("fixture sanity", () => {
  it("fixture has the expected shape", () => {
    expect(fixture.sessions_v2.map((r) => r.session_uri)).toEqual([
      `copilotcli:/${A}`,
      `copilotcli:/${B}`,
      `copilotcli:/${TOMB}`,
      `claude:/${CLAUDE}`,
    ]);
    expect(fixture.metadata[0]).toEqual({ key: `sessionTombstone:copilotcli:/${TOMB}`, value: "true" });
  });
});

describe("AGENT_HOST_COPILOT_PROVIDER", () => {
  it("is copilotcli", () => {
    expect(AGENT_HOST_COPILOT_PROVIDER).toBe("copilotcli");
  });
});

describe("listAgentHostSessionRows on the real-shaped fixture", () => {
  it("returns only live copilotcli rows, newest start first, with exact values", () => {
    const rows = listAgentHostSessionRows(buildFromFixture());
    expect(rows).toEqual([
      {
        id: B,
        sessionUri: `copilotcli:/${B}`,
        title: "Add retry to uploader",
        startedAtMs: 1790805513846,
        modifiedAtMs: 1790809488968,
      },
      {
        id: A,
        sessionUri: `copilotcli:/${A}`,
        title: "Refactor billing module",
        startedAtMs: 1790805037911,
        modifiedAtMs: 1790809488848,
      },
    ]);
  });

  it("skips the tombstoned session (rule 3)", () => {
    const ids = listAgentHostSessionRows(buildFromFixture()).map((r) => r.id);
    expect(ids).not.toContain(TOMB);
  });

  it("skips non-copilotcli providers (rule 1)", () => {
    const ids = listAgentHostSessionRows(buildFromFixture()).map((r) => r.id);
    expect(ids).not.toContain(CLAUDE);
  });
});

describe("getAgentHostSessionRow", () => {
  it("returns the row for a live copilotcli id", () => {
    expect(getAgentHostSessionRow(buildFromFixture(), A)).toEqual({
      id: A,
      sessionUri: `copilotcli:/${A}`,
      title: "Refactor billing module",
      startedAtMs: 1790805037911,
      modifiedAtMs: 1790809488848,
    });
  });

  it("returns undefined for tombstoned, non-copilotcli and unknown ids (rule 7)", () => {
    const db = buildFromFixture();
    expect(getAgentHostSessionRow(db, TOMB)).toBeUndefined();
    expect(getAgentHostSessionRow(db, CLAUDE)).toBeUndefined();
    expect(getAgentHostSessionRow(db, "does-not-exist")).toBeUndefined();
    expect(getAgentHostSessionRow(db, "")).toBeUndefined();
  });

  it("does not match a copilotcli session by a claude-prefixed uri", () => {
    const db = build((w) => insertSession(w, { session_uri: `claude:/${A}`, provider: "copilotcli" }));
    expect(listAgentHostSessionRows(db)).toEqual([]);
    expect(getAgentHostSessionRow(db, A)).toBeUndefined();
  });
});

describe("id extraction (rule 2)", () => {
  it("skips rows whose uri lacks the copilotcli:/ prefix or has an empty id", () => {
    const db = build((w) => {
      insertSession(w, { session_uri: "copilotcli:/", provider: "copilotcli", start_time: 5 });
      insertSession(w, { session_uri: "copilotcli:", provider: "copilotcli", start_time: 6 });
      insertSession(w, { session_uri: "other:/x", provider: "copilotcli", start_time: 7 });
      insertSession(w, { session_uri: "plain-id", provider: "copilotcli", start_time: 8 });
      insertSession(w, { session_uri: "copilotcli:/ok", provider: "copilotcli", start_time: 1 });
    });
    expect(listAgentHostSessionRows(db).map((r) => r.id)).toEqual(["ok"]);
  });

  it("removes only the leading prefix", () => {
    const db = build((w) => insertSession(w, { session_uri: "copilotcli:/copilotcli:/nested" }));
    const rows = listAgentHostSessionRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("copilotcli:/nested");
    expect(rows[0]?.sessionUri).toBe("copilotcli:/copilotcli:/nested");
  });
});

describe("title (rule 4)", () => {
  const titleOf = (payload: string | null | object): string | null => {
    const db = build((w) => insertSession(w, { session_uri: "copilotcli:/t", payload: payload as never }));
    const rows = listAgentHostSessionRows(db);
    expect(rows).toHaveLength(1);
    return rows[0]!.title;
  };

  it("uses payload.data.summary", () => {
    expect(titleOf({ data: { summary: "Hello" } })).toBe("Hello");
  });
  it("is null for a null payload", () => {
    expect(titleOf(null)).toBeNull();
  });
  it("is null for invalid JSON", () => {
    expect(titleOf("{not json")).toBeNull();
    expect(titleOf("")).toBeNull();
  });
  it("is null for JSON that is not an object with data.summary", () => {
    expect(titleOf("null")).toBeNull();
    expect(titleOf("42")).toBeNull();
    expect(titleOf("[]")).toBeNull();
    expect(titleOf({})).toBeNull();
    expect(titleOf({ data: null })).toBeNull();
    expect(titleOf({ data: {} })).toBeNull();
    expect(titleOf({ summary: "top-level is ignored" })).toBeNull();
  });
  it("is null for non-string or blank summaries", () => {
    expect(titleOf({ data: { summary: 5 } })).toBeNull();
    expect(titleOf({ data: { summary: null } })).toBeNull();
    expect(titleOf({ data: { summary: "" } })).toBeNull();
    expect(titleOf({ data: { summary: "   \n\t" } })).toBeNull();
  });
  it("returns a non-blank summary trimmed", () => {
    expect(titleOf({ data: { summary: "  padded  " } })).toBe("padded");
  });
  it("does not use chats[].summary", () => {
    expect(titleOf({ data: { chats: [{ summary: "chat" }] } })).toBeNull();
  });
});

describe("numbers (rule 5)", () => {
  it("maps start_time and modified_time to startedAtMs and modifiedAtMs", () => {
    const db = build((w) => insertSession(w, { session_uri: "copilotcli:/n", start_time: 1790000000123, modified_time: 1790000999999 }));
    const row = getAgentHostSessionRow(db, "n");
    expect(row?.startedAtMs).toBe(1790000000123);
    expect(row?.modifiedAtMs).toBe(1790000999999);
    expect(typeof row?.startedAtMs).toBe("number");
  });
});

describe("ordering (rule 6)", () => {
  it("sorts start_time descending, then session_uri ascending", () => {
    const db = build((w) => {
      insertSession(w, { session_uri: "copilotcli:/b", start_time: 100 });
      insertSession(w, { session_uri: "copilotcli:/a", start_time: 100 });
      insertSession(w, { session_uri: "copilotcli:/c", start_time: 200 });
      insertSession(w, { session_uri: "copilotcli:/z", start_time: 50 });
      insertSession(w, { session_uri: "copilotcli:/aa", start_time: 100 });
    });
    expect(listAgentHostSessionRows(db).map((r) => r.id)).toEqual(["c", "a", "aa", "b", "z"]);
  });
});

describe("tombstones (rule 3)", () => {
  it("only value 'true' on the exact key counts", () => {
    const db = build((w) => {
      insertSession(w, { session_uri: "copilotcli:/dead", start_time: 5 });
      insertSession(w, { session_uri: "copilotcli:/alive-false", start_time: 4 });
      insertSession(w, { session_uri: "copilotcli:/alive-other-key", start_time: 3 });
      const ins = w.prepare("INSERT INTO metadata (key, value) VALUES (?,?)");
      ins.run("sessionTombstone:copilotcli:/dead", "true");
      ins.run("sessionTombstone:copilotcli:/alive-false", "false");
      ins.run("sessionTombstone:claude:/alive-other-key", "true");
    });
    expect(listAgentHostSessionRows(db).map((r) => r.id)).toEqual(["alive-false", "alive-other-key"]);
    expect(getAgentHostSessionRow(db, "dead")).toBeUndefined();
    expect(getAgentHostSessionRow(db, "alive-false")?.id).toBe("alive-false");
  });

  it("a database without a metadata table has no tombstones", () => {
    const schemaNoMeta = schemaSql.replace(/CREATE TABLE metadata \([\s\S]*?\);/, "");
    expect(schemaNoMeta).not.toContain("CREATE TABLE metadata");
    const db = build((w) => insertSession(w, { session_uri: "copilotcli:/x" }), { schema: schemaNoMeta });
    expect(listAgentHostSessionRows(db).map((r) => r.id)).toEqual(["x"]);
    expect(getAgentHostSessionRow(db, "x")?.id).toBe("x");
  });
});

describe("missing sessions_v2 (rule 8)", () => {
  it("returns [] / undefined without a sessions_v2 table", () => {
    const db = build(() => {}, { schema: "CREATE TABLE metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);" });
    expect(listAgentHostSessionRows(db)).toEqual([]);
    expect(getAgentHostSessionRow(db, "x")).toBeUndefined();
  });

  it("returns [] for a completely empty database", () => {
    const db = build(() => {}, { schema: "" });
    expect(listAgentHostSessionRows(db)).toEqual([]);
    expect(getAgentHostSessionRow(db, "x")).toBeUndefined();
  });

  it("returns [] for an empty sessions_v2 table", () => {
    const db = build(() => {});
    expect(listAgentHostSessionRows(db)).toEqual([]);
  });
});

describe("read-only behaviour", () => {
  it("never writes: the DB file is unchanged after reads", () => {
    const file = path.join(dir, "ro.db");
    const w = new DatabaseSync(file);
    w.exec(schemaSql);
    insertSession(w, { session_uri: "copilotcli:/r", start_time: 1 });
    w.close();
    const before = readFileSync(file);
    const db = openReadOnlyDb(file);
    open.push(db);
    listAgentHostSessionRows(db);
    getAgentHostSessionRow(db, "r");
    expect(readFileSync(file).equals(before)).toBe(true);
  });
});
