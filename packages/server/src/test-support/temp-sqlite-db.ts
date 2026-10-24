import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export interface TempSqliteDb {
  dbFile: string;
  cleanup: () => void;
}

// Shared mkdtemp/rmSync boilerplate for tests that build a throwaway SQLite
// fixture file (via `new DatabaseSync(dbFile)` + `db.exec(schema)`) rather
// than checking in an opaque binary .db fixture.
export function createTempSqliteDbPath(prefix: string): TempSqliteDb {
  const dir = mkdtempSync(path.join(tmpdir(), `${prefix}-`));
  return {
    dbFile: path.join(dir, "db.sqlite"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
