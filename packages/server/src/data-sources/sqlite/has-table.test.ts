import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { hasTable } from "./has-table.js";

describe("hasTable", () => {
  const open: DatabaseSync[] = [];
  afterEach(() => {
    for (const db of open.splice(0)) db.close();
  });

  function memoryDb(schema: string): DatabaseSync {
    const db = new DatabaseSync(":memory:");
    db.exec(schema);
    open.push(db);
    return db;
  }

  it("is true for a table the database has", () => {
    expect(hasTable(memoryDb("CREATE TABLE turns (id TEXT)"), "turns")).toBe(true);
  });

  it("is false for a missing table", () => {
    expect(hasTable(memoryDb("CREATE TABLE turns (id TEXT)"), "turn_usage")).toBe(false);
  });

  it("is false for a view or index of that name, which the readers can't query as a table", () => {
    const db = memoryDb("CREATE TABLE t (id TEXT); CREATE VIEW v AS SELECT id FROM t; CREATE INDEX i ON t (id)");

    expect(hasTable(db, "v")).toBe(false);
    expect(hasTable(db, "i")).toBe(false);
  });

  it("treats the name as data, not SQL", () => {
    expect(hasTable(memoryDb("CREATE TABLE turns (id TEXT)"), "turns' OR '1'='1")).toBe(false);
  });
});
