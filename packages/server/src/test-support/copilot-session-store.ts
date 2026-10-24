import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

// The Copilot Chat session store's tables, as Copilot Chat creates them
// (enough for VscodeLogProvider's queries), for tests that compose the
// real Copilot provider over a throwaway user-data dir.
export const COPILOT_SESSION_STORE_SCHEMA = `
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY, cwd TEXT, repository TEXT, branch TEXT, host_type TEXT,
    summary TEXT, agent_name TEXT, agent_description TEXT, created_at TEXT, updated_at TEXT
  );
  CREATE TABLE turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, turn_index INTEGER NOT NULL,
    user_message TEXT, assistant_response TEXT, timestamp TEXT
  );
  CREATE TABLE checkpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, checkpoint_number INTEGER NOT NULL,
    title TEXT, overview TEXT, history TEXT, work_done TEXT, technical_details TEXT,
    important_files TEXT, next_steps TEXT, created_at TEXT
  );
  CREATE TABLE session_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, file_path TEXT NOT NULL,
    tool_name TEXT, turn_index INTEGER, first_seen_at TEXT
  );
`;

// A real main.jsonl with AI Credits numbers, and the session id it belongs to.
export const USAGE_SESSION_ID = "1c7604a0-1488-4b5d-880a-f80fd693475e";
export const USAGE_MAIN_JSONL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/jsonl/real-session-with-usage.jsonl");

// One Copilot Chat session ("Fix the bug", one turn) in a new session store
// at dbPath, started at `startedAt`.
export function seedCopilotSessionStore(dbPath: string, startedAt: string): void {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(COPILOT_SESSION_STORE_SCHEMA);
  db.prepare(
    "INSERT INTO sessions (id, cwd, repository, branch, host_type, summary, agent_name, agent_description, created_at, updated_at) VALUES (?, '/repo', 'org/repo', 'main', 'desktop', 'Fix the bug', 'GitHub Copilot Chat', 'chat', ?, ?)",
  ).run(USAGE_SESSION_ID, startedAt, startedAt);
  db.prepare("INSERT INTO turns (session_id, turn_index, user_message, assistant_response, timestamp) VALUES (?, 0, 'hi', 'hello', ?)").run(
    USAGE_SESSION_ID,
    startedAt,
  );
  db.close();
}

// The session's debug log (with real token and AI Credits figures) under a
// debug-logs dir, as Copilot Chat writes it: <debugLogsDir>/<sessionId>/main.jsonl.
export function writeUsageDebugLog(debugLogsDir: string): void {
  const sessionDir = path.join(debugLogsDir, USAGE_SESSION_ID);
  mkdirSync(sessionDir, { recursive: true });
  copyFileSync(USAGE_MAIN_JSONL, path.join(sessionDir, "main.jsonl"));
}
