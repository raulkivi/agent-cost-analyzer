import type { DatabaseSync } from "node:sqlite";

// A missing table is a shape of the world (a store from an older VS Code, or
// one whose projections never ran), not bad data: readers probe
// sqlite_master instead of letting their query throw.
export function hasTable(db: DatabaseSync, name: string): boolean {
  return (
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name) !== undefined
  );
}
