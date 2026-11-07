// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getCheckpointRows,
  getSessionFileRows,
  getSessionRow,
  getTurnRows,
  listSessionRows,
  listTurnsBySession,
  openReadOnlyDb,
} from "./session-store.js";

const SCHEMA = `
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    cwd TEXT,
    repository TEXT,
    branch TEXT,
    host_type TEXT,
    summary TEXT,
    agent_name TEXT,
    agent_description TEXT,
    created_at TEXT,
    updated_at TEXT
  );
  CREATE TABLE turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    turn_index INTEGER NOT NULL,
    user_message TEXT,
    assistant_response TEXT,
    timestamp TEXT
  );
  CREATE TABLE checkpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    checkpoint_number INTEGER NOT NULL,
    title TEXT,
    overview TEXT,
    history TEXT,
    work_done TEXT,
    technical_details TEXT,
    important_files TEXT,
    next_steps TEXT,
    created_at TEXT
  );
  CREATE TABLE session_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    tool_name TEXT,
    turn_index INTEGER,
    first_seen_at TEXT
  );
`;

function seedDb(db: DatabaseSync): void {
  db.exec(SCHEMA);
  db.exec(`
    INSERT INTO sessions (id, cwd, repository, branch, host_type, summary, agent_name, agent_description, created_at, updated_at)
    VALUES
      ('session-1', '/repo', 'org/repo', 'main', 'desktop', 'Fix the bug', 'GitHub Copilot Chat', 'chat', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'),
      ('session-2', '/repo', 'org/repo', 'main', 'desktop', 'Older session', 'GitHub Copilot Chat', 'chat', '2025-12-01T00:00:00.000Z', '2025-12-01T00:00:00.000Z'),
      ('session-3', '/repo', 'org/repo', 'main', 'desktop', 'Not chat', 'panel/editAgent', 'edit', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

    INSERT INTO turns (session_id, turn_index, user_message, assistant_response, timestamp)
    VALUES
      ('session-1', 1, 'hi', 'hello', '2026-01-01T00:00:01.000Z'),
      ('session-1', 0, 'first', 'first reply', '2026-01-01T00:00:00.000Z');

    INSERT INTO checkpoints (session_id, checkpoint_number, title, overview, created_at)
    VALUES
      ('session-1', 2, 'Checkpoint 2', 'overview 2', '2026-01-01T00:00:05.000Z'),
      ('session-1', 1, 'Checkpoint 1', 'overview 1', '2026-01-01T00:00:03.000Z');

    INSERT INTO session_files (session_id, file_path, tool_name, turn_index, first_seen_at)
    VALUES
      ('session-1', 'src/a.ts', 'read_file', 0, '2026-01-01T00:00:00.500Z'),
      ('session-1', 'src/b.ts', 'edit_file', 1, '2026-01-01T00:00:01.500Z');
  `);
}

describe("session-store", () => {
  let dbFile: string;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "session-store-test-"));
    dbFile = path.join(dir, "session-store.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("listSessionRows returns only GitHub Copilot Chat sessions, most recently updated first", () => {
    const db = new DatabaseSync(dbFile);
    seedDb(db);

    const rows = listSessionRows(db);

    expect(rows.map((row) => row.id)).toEqual(["session-1", "session-2"]);
    db.close();
  });

  it("listSessionRows includes each session's turn_count without a per-session query", () => {
    const db = new DatabaseSync(dbFile);
    seedDb(db);

    const rows = listSessionRows(db);

    expect(rows.find((row) => row.id === "session-1")?.turn_count).toBe(2);
    expect(rows.find((row) => row.id === "session-2")?.turn_count).toBe(0);
    db.close();
  });

  it("getSessionRow returns a single Copilot Chat session by id, undefined otherwise", () => {
    const db = new DatabaseSync(dbFile);
    seedDb(db);

    expect(getSessionRow(db, "session-1")?.summary).toBe("Fix the bug");
    expect(getSessionRow(db, "session-3")).toBeUndefined();
    expect(getSessionRow(db, "does-not-exist")).toBeUndefined();
    db.close();
  });

  it("getTurnRows returns turns for a session ordered by turn_index", () => {
    const db = new DatabaseSync(dbFile);
    seedDb(db);

    const rows = getTurnRows(db, "session-1");

    expect(rows.map((row) => row.turn_index)).toEqual([0, 1]);
    db.close();
  });

  it("listTurnsBySession returns every session's turn indices and user messages, ordered, in one query", () => {
    const db = new DatabaseSync(dbFile);
    seedDb(db);

    const turns = listTurnsBySession(db);

    expect(turns.get("session-1")?.map((turn) => turn.turn_index)).toEqual([0, 1]);
    expect(turns.get("session-1")?.[0]).toEqual({ turn_index: 0, user_message: expect.any(String) });
    expect(turns.has("session-2")).toBe(false);
    db.close();
  });

  it("getCheckpointRows returns checkpoints for a session ordered by checkpoint_number", () => {
    const db = new DatabaseSync(dbFile);
    seedDb(db);

    const rows = getCheckpointRows(db, "session-1");

    expect(rows.map((row) => row.checkpoint_number)).toEqual([1, 2]);
    db.close();
  });

  it("getSessionFileRows returns all file rows for a session", () => {
    const db = new DatabaseSync(dbFile);
    seedDb(db);

    const rows = getSessionFileRows(db, "session-1");

    expect(rows.map((row) => row.file_path)).toEqual(["src/a.ts", "src/b.ts"]);
    db.close();
  });

  it("openReadOnlyDb opens an existing db file read-only and can query it", () => {
    const seedingDb = new DatabaseSync(dbFile);
    seedDb(seedingDb);
    seedingDb.close();

    const db = openReadOnlyDb(dbFile);
    expect(listSessionRows(db).length).toBe(2);
    db.close();
  });
});
