// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTempSqliteDbPath, type TempSqliteDb } from "../../test-support/temp-sqlite-db.js";
import { openAgentTracesDbReadOnly } from "../agent-traces/agent-traces-reader.js";
import { openReadOnlyDb } from "./session-store.js";

const HOLD_LOCK_MS = 300;

// Plays the owning app: takes the write lock of a rollback-journal DB, tells
// the parent, holds it for HOLD_LOCK_MS, then commits.
const WRITER_SCRIPT = `
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.argv[1]);
db.exec("BEGIN EXCLUSIVE");
db.exec("INSERT INTO t (v) VALUES ('late')");
process.stdout.write("locked\\n");
setTimeout(() => { db.exec("COMMIT"); db.close(); }, ${HOLD_LOCK_MS});
`;

async function startWriterHoldingLock(dbFile: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["-e", WRITER_SCRIPT, dbFile], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  await once(child.stdout!, "data");
  return child;
}

const openers = [
  ["openReadOnlyDb", openReadOnlyDb],
  ["openAgentTracesDbReadOnly", openAgentTracesDbReadOnly],
] as const;

describe.each(openers)("%s", (_name, open) => {
  let temp: TempSqliteDb;
  let writer: ChildProcess | undefined;

  beforeEach(() => {
    temp = createTempSqliteDbPath("read-only-open");
    const db = new DatabaseSync(temp.dbFile);
    db.exec("PRAGMA journal_mode = DELETE");
    db.exec("CREATE TABLE t (v TEXT); INSERT INTO t (v) VALUES ('early')");
    db.close();
  });

  afterEach(async () => {
    if (writer && writer.exitCode === null) {
      await once(writer, "exit");
    }
    writer = undefined;
    temp.cleanup();
  });

  it("sets a busy timeout so a read can wait for a commit", () => {
    const db = open(temp.dbFile);
    try {
      const row = db.prepare("PRAGMA busy_timeout").get() as { timeout: number };
      expect(row.timeout).toBeGreaterThanOrEqual(1000);
    } finally {
      db.close();
    }
  });

  it("waits for the owning app's commit instead of failing with 'database is locked'", async () => {
    writer = await startWriterHoldingLock(temp.dbFile);
    const db = open(temp.dbFile);
    try {
      const rows = db.prepare("SELECT v FROM t ORDER BY rowid").all() as { v: string }[];
      expect(rows.map((r) => r.v)).toEqual(["early", "late"]);
    } finally {
      db.close();
    }
  });

  it("stays read-only", () => {
    const db = open(temp.dbFile);
    try {
      expect(() => db.exec("INSERT INTO t (v) VALUES ('x')")).toThrow(/readonly/i);
    } finally {
      db.close();
    }
  });
});
