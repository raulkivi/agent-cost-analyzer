import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import {
  AGENT_HOST_COPILOT_PROVIDER,
  getAgentHostSessionRow,
  listAgentHostSessionRows,
  readAgentHostSdkSessionId,
} from "./agent-host-catalog.js";

// Real DDL, verbatim from fixtures/agent-host/agent-host.schema.sql.
const SESSIONS_V2_DDL = `
  CREATE TABLE sessions_v2 (
    session_uri         TEXT PRIMARY KEY NOT NULL,
    provider            TEXT NOT NULL,
    start_time          INTEGER NOT NULL,
    external            INTEGER,
    registration_source TEXT NOT NULL,
    session_generation  TEXT,
    source_revision     INTEGER CHECK (source_revision >= 0),
    payload_version     INTEGER CHECK (payload_version >= 0),
    payload_hash        TEXT,
    verified            INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
    payload             TEXT,
    is_chat_backing     INTEGER NOT NULL DEFAULT 0 CHECK (is_chat_backing IN (0, 1)),
    modified_time       INTEGER NOT NULL DEFAULT 0
  )
`;

const METADATA_DDL = `
  CREATE TABLE metadata (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  )
`;

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/agent-host",
);

interface CatalogFixtureRow {
  session_uri: string;
  provider: string;
  start_time: number;
  modified_time: number;
  payload: unknown;
}

const catalogFixture = JSON.parse(
  readFileSync(path.join(fixturesDir, "catalog-rows.json"), "utf-8"),
) as { sessions_v2: CatalogFixtureRow[]; metadata: { key: string; value: string }[] };

const URI_1 = "copilotcli:/3f2a9c10-1111-4a1b-8c01-aaaaaaaaaaa1";
const URI_2 = "copilotcli:/3f2a9c10-2222-4a1b-8c02-bbbbbbbbbbb2";
const URI_TOMBSTONED = "copilotcli:/3f2a9c10-3333-4a1b-8c03-ccccccccccc3";

interface SeedRow {
  sessionUri: string;
  provider?: string;
  startTime?: number;
  modifiedTime?: number;
  // Serialized when an object; kept verbatim when a string (invalid JSON
  // payloads are realistic — the column is plain TEXT); SQL NULL otherwise.
  payload?: unknown;
}

function seedSessions(db: DatabaseSync, rows: SeedRow[]): void {
  const insert = db.prepare(
    "INSERT INTO sessions_v2 (session_uri, provider, start_time, registration_source, payload, modified_time) " +
      "VALUES (?, ?, ?, 'explicit', ?, ?)",
  );
  for (const row of rows) {
    const payload =
      row.payload === undefined || row.payload === null
        ? null
        : typeof row.payload === "string"
          ? row.payload
          : JSON.stringify(row.payload);
    insert.run(
      row.sessionUri,
      row.provider ?? AGENT_HOST_COPILOT_PROVIDER,
      row.startTime ?? 0,
      payload,
      row.modifiedTime ?? 0,
    );
  }
}

function seedMetadata(db: DatabaseSync, rows: { key: string; value: string }[]): void {
  db.exec(METADATA_DDL);
  const insert = db.prepare("INSERT INTO metadata (key, value) VALUES (?, ?)");
  for (const row of rows) {
    insert.run(row.key, row.value);
  }
}

// The fixture stores payloads as objects; stringify on the way in.
function seedFixture(db: DatabaseSync, withMetadata: boolean): void {
  seedSessions(
    db,
    catalogFixture.sessions_v2.map((row) => ({
      sessionUri: row.session_uri,
      provider: row.provider,
      startTime: row.start_time,
      modifiedTime: row.modified_time,
      payload: row.payload,
    })),
  );
  if (withMetadata) {
    seedMetadata(db, catalogFixture.metadata);
  }
}

describe("listAgentHostSessionRows", () => {
  let dir: string;
  let dbFile: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "agent-host-catalog-test-"));
    dbFile = path.join(dir, "catalog.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("AGENT_HOST_COPILOT_PROVIDER is copilotcli", () => {
    expect(AGENT_HOST_COPILOT_PROVIDER).toBe("copilotcli");
  });

  it("lists copilotcli rows from the fixture, newest start first, tombstoned and foreign-provider rows skipped", () => {
    const db = new DatabaseSync(dbFile);
    db.exec(SESSIONS_V2_DDL);
    seedFixture(db, true);

    expect(listAgentHostSessionRows(db)).toEqual([
      {
        id: "3f2a9c10-2222-4a1b-8c02-bbbbbbbbbbb2",
        sessionUri: URI_2,
        title: "Add retry to uploader",
        startedAtMs: 1790805513846,
        modifiedAtMs: 1790809488968,
      },
      {
        id: "3f2a9c10-1111-4a1b-8c01-aaaaaaaaaaa1",
        sessionUri: URI_1,
        title: "Refactor billing module",
        startedAtMs: 1790805037911,
        modifiedAtMs: 1790809488848,
      },
    ]);
  });

  it("lists a tombstoned session when the database has no metadata table", () => {
    const db = new DatabaseSync(dbFile);
    db.exec(SESSIONS_V2_DDL);
    seedFixture(db, false);

    const ids = listAgentHostSessionRows(db).map((row) => row.id);
    expect(ids).toEqual([
      "3f2a9c10-2222-4a1b-8c02-bbbbbbbbbbb2",
      "3f2a9c10-1111-4a1b-8c01-aaaaaaaaaaa1",
      "3f2a9c10-3333-4a1b-8c03-ccccccccccc3",
    ]);
  });

  it("returns [] when there is no sessions_v2 table", () => {
    const db = new DatabaseSync(dbFile);
    expect(listAgentHostSessionRows(db)).toEqual([]);
  });

  it("skips rows whose session_uri does not start with copilotcli:/", () => {
    const db = new DatabaseSync(dbFile);
    db.exec(SESSIONS_V2_DDL);
    seedSessions(db, [
      { sessionUri: "vscode-local:/abc", startTime: 100 },
      { sessionUri: "copilotcliX:/def", startTime: 200 },
      { sessionUri: URI_1, startTime: 300 },
    ]);

    expect(listAgentHostSessionRows(db).map((row) => row.sessionUri)).toEqual([URI_1]);
  });

  it("skips a row whose id is empty", () => {
    const db = new DatabaseSync(dbFile);
    db.exec(SESSIONS_V2_DDL);
    seedSessions(db, [
      { sessionUri: "copilotcli:/" },
      { sessionUri: URI_1 },
    ]);

    expect(listAgentHostSessionRows(db).map((row) => row.id)).toEqual([
      "3f2a9c10-1111-4a1b-8c01-aaaaaaaaaaa1",
    ]);
  });

  it("tombstones only metadata values equal to 'true'", () => {
    const db = new DatabaseSync(dbFile);
    db.exec(SESSIONS_V2_DDL);
    seedSessions(db, [
      { sessionUri: URI_1, startTime: 1 },
      { sessionUri: URI_2, startTime: 2 },
      { sessionUri: URI_TOMBSTONED, startTime: 3 },
    ]);
    seedMetadata(db, [
      { key: `sessionTombstone:${URI_1}`, value: "true" },
      { key: `sessionTombstone:${URI_2}`, value: "false" },
      { key: `sessionTombstone:${URI_TOMBSTONED}`, value: "TRUE" },
      { key: "sessionTombstone:deleted-but-not-a-row", value: "true" },
      { key: "sessionRegistryBackfilled:copilotcli", value: "true" },
    ]);

    expect(listAgentHostSessionRows(db).map((row) => row.id)).toEqual([
      "3f2a9c10-3333-4a1b-8c03-ccccccccccc3",
      "3f2a9c10-2222-4a1b-8c02-bbbbbbbbbbb2",
    ]);
  });

  it("breaks ties in start_time by session_uri ascending", () => {
    const db = new DatabaseSync(dbFile);
    db.exec(SESSIONS_V2_DDL);
    seedSessions(db, [
      { sessionUri: "copilotcli:/b", startTime: 1000 },
      { sessionUri: "copilotcli:/a", startTime: 1000 },
      { sessionUri: "copilotcli:/newest", startTime: 2000 },
    ]);

    expect(listAgentHostSessionRows(db).map((row) => row.sessionUri)).toEqual([
      "copilotcli:/newest",
      "copilotcli:/a",
      "copilotcli:/b",
    ]);
  });

  describe("title from payload data.summary", () => {
    const titleCases: { sessionUri: string; payload?: unknown; title: string | null }[] = [
      { sessionUri: "copilotcli:/t-trim", payload: { data: { summary: "  Padded \n" } }, title: "Padded" },
      { sessionUri: "copilotcli:/t-blank", payload: { data: { summary: "   " } }, title: null },
      { sessionUri: "copilotcli:/t-empty", payload: { data: { summary: "" } }, title: null },
      { sessionUri: "copilotcli:/t-number", payload: { data: { summary: 42 } }, title: null },
      { sessionUri: "copilotcli:/t-object", payload: { data: { summary: {} } }, title: null },
      { sessionUri: "copilotcli:/t-chats", payload: { data: { chats: [{ summary: "Chat summary" }] } }, title: null },
      { sessionUri: "copilotcli:/t-nodata", payload: { payloadVersion: 2 }, title: null },
      { sessionUri: "copilotcli:/t-datanull", payload: { data: null }, title: null },
      { sessionUri: "copilotcli:/t-array", payload: [1, 2], title: null },
      { sessionUri: "copilotcli:/t-scalar", payload: 7, title: null },
      { sessionUri: "copilotcli:/ts-null", payload: null, title: null },
      { sessionUri: "copilotcli:/ts-invalid", payload: "{not: json", title: null },
    ];

    it("maps each payload shape to its title, ignoring chats[].summary", () => {
      const db = new DatabaseSync(dbFile);
      db.exec(SESSIONS_V2_DDL);
      seedSessions(
        db,
        titleCases.map((testCase) => ({
          sessionUri: testCase.sessionUri,
          payload: testCase.payload,
        })),
      );

      const titles = new Map(
        listAgentHostSessionRows(db).map((row) => [row.sessionUri, row.title]),
      );
      for (const testCase of titleCases) {
        expect(titles.get(testCase.sessionUri)).toBe(testCase.title);
      }
    });
  });
});

describe("getAgentHostSessionRow", () => {
  let dir: string;
  let dbFile: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "agent-host-catalog-get-test-"));
    dbFile = path.join(dir, "catalog.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function fixtureDb(withMetadata: boolean): DatabaseSync {
    const db = new DatabaseSync(dbFile);
    db.exec(SESSIONS_V2_DDL);
    seedFixture(db, withMetadata);
    return db;
  }

  it("returns the row for a known copilotcli id, matching the listed row", () => {
    const db = fixtureDb(true);
    const listed = listAgentHostSessionRows(db);

    expect(getAgentHostSessionRow(db, "3f2a9c10-1111-4a1b-8c01-aaaaaaaaaaa1")).toEqual(listed[1]);
    expect(getAgentHostSessionRow(db, "3f2a9c10-2222-4a1b-8c02-bbbbbbbbbbb2")).toEqual(listed[0]);
  });

  it("returns undefined for an unknown id", () => {
    const db = fixtureDb(true);
    expect(getAgentHostSessionRow(db, "does-not-exist")).toBeUndefined();
  });

  it("returns undefined for a tombstoned id", () => {
    const db = fixtureDb(true);
    expect(getAgentHostSessionRow(db, "3f2a9c10-3333-4a1b-8c03-ccccccccccc3")).toBeUndefined();
  });

  it("returns the row for a tombstoned session when the database has no metadata table", () => {
    const db = fixtureDb(false);
    expect(getAgentHostSessionRow(db, "3f2a9c10-3333-4a1b-8c03-ccccccccccc3")).toEqual({
      id: "3f2a9c10-3333-4a1b-8c03-ccccccccccc3",
      sessionUri: URI_TOMBSTONED,
      title: "Deleted session",
      startedAtMs: 1790800000000,
      modifiedAtMs: 1790801000000,
    });
  });

  it("returns undefined for a foreign-provider id", () => {
    const db = fixtureDb(true);
    expect(getAgentHostSessionRow(db, "3f2a9c10-4444-4a1b-8c04-ddddddddddd4")).toBeUndefined();
  });

  it("returns undefined when a row exists with empty id", () => {
    const db = new DatabaseSync(dbFile);
    db.exec(SESSIONS_V2_DDL);
    seedSessions(db, [{ sessionUri: "copilotcli:/" }]);
    expect(getAgentHostSessionRow(db, "")).toBeUndefined();
  });

  it("returns undefined when there is no sessions_v2 table", () => {
    const db = new DatabaseSync(dbFile);
    expect(getAgentHostSessionRow(db, "anything")).toBeUndefined();
  });
});

// Columns the chat rows carry in agent-host.db; only the ones the reader uses
// are populated, the rest take their defaults.
const CHATS_V2_DDL = `
  CREATE TABLE chats_v2 (
    chat_uri          TEXT PRIMARY KEY NOT NULL,
    owner_session_uri TEXT NOT NULL,
    chat_order        INTEGER,
    provider_data     TEXT
  )
`;

const SDK_OWNER = "copilotcli:/3f2a9c10-1111-4a1b-8c01-aaaaaaaaaaa1";

function chatsDb(
  rows: { chatUri: string; chatOrder?: number | null; providerData: string | null }[],
): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(CHATS_V2_DDL);
  const insert = db.prepare(
    "INSERT INTO chats_v2 (chat_uri, owner_session_uri, chat_order, provider_data) VALUES (?, ?, ?, ?)",
  );
  for (const row of rows) {
    insert.run(row.chatUri, SDK_OWNER, row.chatOrder ?? null, row.providerData);
  }
  return db;
}

describe("readAgentHostSdkSessionId", () => {
  it("returns sdkSessionId from the chat row's provider_data", () => {
    const db = chatsDb([
      {
        chatUri: "chat-1",
        chatOrder: 0,
        providerData: '{"sdkSessionId":"5d1a0001-aaaa","model":"gpt-5"}',
      },
    ]);
    expect(readAgentHostSdkSessionId(db, SDK_OWNER)).toBe("5d1a0001-aaaa");
  });

  it("returns null when the session has no chats_v2 table", () => {
    const db = new DatabaseSync(":memory:");
    expect(readAgentHostSdkSessionId(db, SDK_OWNER)).toBeNull();
  });

  it("returns null when no chat row belongs to the session", () => {
    const db = chatsDb([
      {
        chatUri: "chat-1",
        providerData: '{"sdkSessionId":"x"}',
      },
    ]);
    expect(readAgentHostSdkSessionId(db, "copilotcli:/someone-else")).toBeNull();
  });

  it("returns null when the session has no chat rows", () => {
    const db = chatsDb([]);
    expect(readAgentHostSdkSessionId(db, SDK_OWNER)).toBeNull();
  });

  // Each of these is a row the reader must step over rather than throw on.
  const unusable: [string, string | null][] = [
    ["NULL provider_data", null],
    ["provider_data that is not JSON", "not json"],
    ["a JSON array", "[1]"],
    ["a JSON scalar", '"5d1a"'],
    ["a JSON null", "null"],
    ["an object without sdkSessionId", "{}"],
    ["an empty sdkSessionId", '{"sdkSessionId":""}'],
    ["a non-string sdkSessionId", '{"sdkSessionId":5}'],
  ];

  it.each(unusable)("skips a row with %s and takes the next usable row", (_label, value) => {
    const db = chatsDb([
      { chatUri: "bad", chatOrder: 0, providerData: value },
      { chatUri: "good", chatOrder: 1, providerData: '{"sdkSessionId":"good-id"}' },
    ]);
    expect(readAgentHostSdkSessionId(db, SDK_OWNER)).toBe("good-id");
  });

  it("returns null when every row is unusable", () => {
    const db = chatsDb([
      { chatUri: "a", chatOrder: 0, providerData: "[1]" },
      { chatUri: "b", chatOrder: 1, providerData: "{}" },
    ]);
    expect(readAgentHostSdkSessionId(db, SDK_OWNER)).toBeNull();
  });

  it("orders by chat_order ascending, with NULL chat_order last", () => {
    const db = chatsDb([
      { chatUri: "null-order", chatOrder: null, providerData: '{"sdkSessionId":"null"}' },
      { chatUri: "second", chatOrder: 2, providerData: '{"sdkSessionId":"second"}' },
      { chatUri: "first", chatOrder: 1, providerData: '{"sdkSessionId":"first"}' },
    ]);
    expect(readAgentHostSdkSessionId(db, SDK_OWNER)).toBe("first");
  });

  it("puts NULL chat_order last even when it was inserted first", () => {
    const db = chatsDb([
      { chatUri: "null-order", chatOrder: null, providerData: '{"sdkSessionId":"null"}' },
      { chatUri: "ordered", chatOrder: 7, providerData: '{"sdkSessionId":"ordered"}' },
    ]);
    expect(readAgentHostSdkSessionId(db, SDK_OWNER)).toBe("ordered");
  });

  it("breaks chat_order ties by rowid", () => {
    const db = chatsDb([
      { chatUri: "inserted-first", chatOrder: 3, providerData: '{"sdkSessionId":"first"}' },
      { chatUri: "inserted-second", chatOrder: 3, providerData: '{"sdkSessionId":"second"}' },
    ]);
    // Both rows share chat_order 3; the first inserted wins.
    expect(readAgentHostSdkSessionId(db, SDK_OWNER)).toBe("first");
  });
});
