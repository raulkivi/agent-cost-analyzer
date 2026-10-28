import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { agentHostDbPath, agentSessionDbPath } from "../data-sources/agent-host/agent-host-paths.js";

// Builds VS Code Agent Host stores (vscode-extension.md step 10.13) inside a
// throwaway user-data dir from the redacted fixtures in
// fixtures/agent-host/: the real DDL plus sample rows, so tests exercise the
// real table shapes.

const FIXTURES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/agent-host");

// Rows per table; a non-string, non-number value (a JSON column) is stored
// as its JSON text, as VS Code writes it.
export type AgentHostTableRows = Record<string, Record<string, unknown>[]>;

export const AGENT_HOST_FIXTURE_SESSION_IDS = {
  // Listed; tests give it the session.db fixture.
  withTurns: "3f2a9c10-1111-4a1b-8c01-aaaaaaaaaaa1",
  // Listed; newer than withTurns.
  second: "3f2a9c10-2222-4a1b-8c02-bbbbbbbbbbb2",
  // Tombstoned in the catalog's metadata.
  deleted: "3f2a9c10-3333-4a1b-8c03-ccccccccccc3",
  // A Claude harness session (provider "claude"), left out.
  claude: "3f2a9c10-4444-4a1b-8c04-ddddddddddd4",
} as const;

export function readAgentHostFixtureRows(fileName: "catalog-rows.json" | "session-rows.json"): AgentHostTableRows {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, fileName), "utf8")) as AgentHostTableRows;
}

function sqlValue(value: unknown): string | number | null {
  if (value === null || value === undefined || typeof value === "string" || typeof value === "number") {
    return value ?? null;
  }
  return JSON.stringify(value);
}

function buildDb(dbPath: string, schemaFile: string, rows: AgentHostTableRows): void {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA foreign_keys = OFF;");
    db.exec(readFileSync(path.join(FIXTURES_DIR, schemaFile), "utf8"));
    for (const [table, tableRows] of Object.entries(rows)) {
      for (const row of tableRows) {
        const columns = Object.keys(row);
        db.prepare(
          `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
        ).run(...columns.map((column) => sqlValue(row[column])));
      }
    }
  } finally {
    db.close();
  }
}

// <userData>/User/globalStorage/agent-host.db with the catalog fixture rows.
export function writeAgentHostCatalog(
  userDataDir: string,
  rows: AgentHostTableRows = readAgentHostFixtureRows("catalog-rows.json"),
): string {
  const dbPath = agentHostDbPath(userDataDir);
  buildDb(dbPath, "agent-host.schema.sql", rows);
  return dbPath;
}

// <userData>/agentSessionData/<sessionId>/session.db with the session
// fixture rows.
export function writeAgentSessionDb(
  userDataDir: string,
  sessionId: string,
  rows: AgentHostTableRows = readAgentHostFixtureRows("session-rows.json"),
): string {
  const dbPath = agentSessionDbPath(userDataDir, sessionId);
  if (dbPath === null) {
    throw new Error(`unsafe Agent Host session id ${sessionId}`);
  }
  return writeAgentSessionDbAt(dbPath, rows);
}

// A session.db at any path, for tests of where the source must not look.
export function writeAgentSessionDbAt(
  dbPath: string,
  rows: AgentHostTableRows = readAgentHostFixtureRows("session-rows.json"),
): string {
  buildDb(dbPath, "session.schema.sql", rows);
  return dbPath;
}

// The session fixture without the turns that have no turn_usage row, so
// every turn has AI Credits and the session total is known.
export function sessionRowsWithUsageOnly(rows: AgentHostTableRows = readAgentHostFixtureRows("session-rows.json")): AgentHostTableRows {
  const withUsage = new Set(rows.turn_usage.map((usage) => usage.turn_id));
  return { ...rows, turns: rows.turns.filter((turn) => withUsage.has(turn.id)) };
}

// Each turn_usage row's _meta.copilotUsage.totalNanoAiu, in row order.
export function fixtureTurnNanoAiu(rows: AgentHostTableRows): number[] {
  return rows.turn_usage.map((usage) => {
    const meta = (usage.usage as { _meta: { copilotUsage: { totalNanoAiu: number } } })._meta;
    return meta.copilotUsage.totalNanoAiu;
  });
}
