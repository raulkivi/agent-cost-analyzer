// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { DatabaseSync } from "node:sqlite";

const COPILOT_CHAT_AGENT_NAME = "GitHub Copilot Chat";

export interface SessionRow {
  id: string;
  cwd: string | null;
  repository: string | null;
  branch: string | null;
  host_type: string | null;
  summary: string | null;
  agent_name: string | null;
  agent_description: string | null;
  created_at: string | null;
  updated_at: string | null;
  turn_count: number;
}

export interface TurnRow {
  id: number;
  session_id: string;
  turn_index: number;
  user_message: string | null;
  assistant_response: string | null;
  timestamp: string | null;
}

export interface CheckpointRow {
  id: number;
  session_id: string;
  checkpoint_number: number;
  title: string | null;
  overview: string | null;
  history: string | null;
  work_done: string | null;
  technical_details: string | null;
  important_files: string | null;
  next_steps: string | null;
  created_at: string | null;
}

export interface SessionFileRow {
  id: number;
  session_id: string;
  file_path: string;
  tool_name: string | null;
  turn_index: number | null;
  first_seen_at: string | null;
}

export function openReadOnlyDb(dbPath: string): DatabaseSync {
  return new DatabaseSync(dbPath, { readOnly: true });
}

// turn_count is a correlated subquery rather than a JOIN so each session row
// stays one row (a JOIN against turns would multiply rows per turn) — one
// query for the whole list, no N+1 per-session follow-up query.
const TURN_COUNT_SELECT =
  "SELECT sessions.*, " +
  "(SELECT COUNT(*) FROM turns WHERE turns.session_id = sessions.id) AS turn_count " +
  "FROM sessions";

export function listSessionRows(db: DatabaseSync): SessionRow[] {
  return db
    .prepare(`${TURN_COUNT_SELECT} WHERE agent_name = ? ORDER BY updated_at DESC`)
    .all(COPILOT_CHAT_AGENT_NAME) as unknown as SessionRow[];
}

export function getSessionRow(db: DatabaseSync, id: string): SessionRow | undefined {
  return db
    .prepare(`${TURN_COUNT_SELECT} WHERE agent_name = ? AND id = ?`)
    .get(COPILOT_CHAT_AGENT_NAME, id) as unknown as SessionRow | undefined;
}

export function getTurnRows(db: DatabaseSync, sessionId: string): TurnRow[] {
  return db
    .prepare("SELECT * FROM turns WHERE session_id = ? ORDER BY turn_index ASC")
    .all(sessionId) as unknown as TurnRow[];
}

// A turn without its assistant response or timestamp.
export type TurnKeyRow = Pick<TurnRow, "turn_index" | "user_message">;

// Every session's turns (index and user message, the keys the debug log is
// joined on) in one query, for the session list: a summary counts the same
// turns as the full session (session-enricher's summarizeSessionUsage)
// without reading each session's responses.
export function listTurnsBySession(db: DatabaseSync): Map<string, TurnKeyRow[]> {
  const rows = db
    .prepare("SELECT session_id, turn_index, user_message FROM turns ORDER BY session_id, turn_index ASC")
    .all() as unknown as (TurnKeyRow & Pick<TurnRow, "session_id">)[];
  const bySession = new Map<string, TurnKeyRow[]>();
  for (const { session_id, ...turn } of rows) {
    const turns = bySession.get(session_id) ?? [];
    turns.push(turn);
    bySession.set(session_id, turns);
  }
  return bySession;
}

export function getCheckpointRows(db: DatabaseSync, sessionId: string): CheckpointRow[] {
  return db
    .prepare("SELECT * FROM checkpoints WHERE session_id = ? ORDER BY checkpoint_number ASC")
    .all(sessionId) as unknown as CheckpointRow[];
}

export function getSessionFileRows(db: DatabaseSync, sessionId: string): SessionFileRow[] {
  return db
    .prepare("SELECT * FROM session_files WHERE session_id = ?")
    .all(sessionId) as unknown as SessionFileRow[];
}
