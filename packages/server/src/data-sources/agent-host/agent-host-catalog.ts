import type { DatabaseSync } from "node:sqlite";
import { hasTable } from "../sqlite/has-table.js";

export const AGENT_HOST_COPILOT_PROVIDER = "copilotcli";

const SESSION_URI_PREFIX = `${AGENT_HOST_COPILOT_PROVIDER}:/`;
const TOMBSTONE_KEY_PREFIX = "sessionTombstone:";

export interface AgentHostSessionRow {
  /** session_uri without the `copilotcli:/` prefix */
  id: string;
  sessionUri: string;
  /** payload JSON data.summary */
  title: string | null;
  /** start_time */
  startedAtMs: number;
  /** modified_time */
  modifiedAtMs: number;
}

interface SessionV2DbRow {
  session_uri: string;
  payload: string | null;
  start_time: number;
  modified_time: number;
}

// One select shared by both readers so neither can drift from the other's
// shape; callers append their own WHERE clause.
const SELECT_SESSION =
  "SELECT session_uri, payload, start_time, modified_time FROM sessions_v2";

// Session-level summary only: a payload that hides the title inside
// chats[].summary stays untitled.
function readTitle(payload: string | null): string | null {
  if (payload === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const data = (parsed as Record<string, unknown>).data;
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const summary = (data as Record<string, unknown>).summary;
  if (typeof summary !== "string") {
    return null;
  }
  const trimmed = summary.trim();
  return trimmed === "" ? null : trimmed;
}

function toRow(dbRow: SessionV2DbRow): AgentHostSessionRow | null {
  if (!dbRow.session_uri.startsWith(SESSION_URI_PREFIX)) {
    return null;
  }
  const id = dbRow.session_uri.slice(SESSION_URI_PREFIX.length);
  if (id === "") {
    return null;
  }
  return {
    id,
    sessionUri: dbRow.session_uri,
    title: readTitle(dbRow.payload),
    startedAtMs: dbRow.start_time,
    modifiedAtMs: dbRow.modified_time,
  };
}

// Full tombstone keys of the sessions whose metadata marks them deleted;
// membership test keeps a foreign `sessionTombstone:...` metadata row from
// matching an unrelated session_uri.
function tombstoneKeys(db: DatabaseSync): Set<string> {
  if (!hasTable(db, "metadata")) {
    return new Set<string>();
  }
  const metaRows = db
    .prepare("SELECT key FROM metadata WHERE value = 'true'")
    .all() as unknown as { key: string }[];
  return new Set(
    metaRows
      .filter((meta) => meta.key.startsWith(TOMBSTONE_KEY_PREFIX))
      .map((meta) => meta.key),
  );
}

export function listAgentHostSessionRows(db: DatabaseSync): AgentHostSessionRow[] {
  if (!hasTable(db, "sessions_v2")) {
    return [];
  }
  const dbRows = db
    .prepare(`${SELECT_SESSION} WHERE provider = ? ORDER BY start_time DESC, session_uri ASC`)
    .all(AGENT_HOST_COPILOT_PROVIDER) as unknown as SessionV2DbRow[];
  const tombstones = tombstoneKeys(db);

  const rows: AgentHostSessionRow[] = [];
  for (const dbRow of dbRows) {
    if (tombstones.has(TOMBSTONE_KEY_PREFIX + dbRow.session_uri)) {
      continue;
    }
    const row = toRow(dbRow);
    if (row) {
      rows.push(row);
    }
  }
  return rows;
}

export function getAgentHostSessionRow(
  db: DatabaseSync,
  id: string,
): AgentHostSessionRow | undefined {
  if (!hasTable(db, "sessions_v2")) {
    return undefined;
  }
  // Rows are keyed by the full uri; the empty id would collide with the
  // degenerate `copilotcli:/` row which rule 2 drops from the catalog.
  if (id === "") {
    return undefined;
  }
  const sessionUri = SESSION_URI_PREFIX + id;
  const dbRow = db
    .prepare(`${SELECT_SESSION} WHERE session_uri = ? AND provider = ?`)
    .get(sessionUri, AGENT_HOST_COPILOT_PROVIDER) as unknown as
    | SessionV2DbRow
    | undefined;
  if (dbRow === undefined) {
    return undefined;
  }
  if (hasTable(db, "metadata")) {
    const meta = db
      .prepare("SELECT value FROM metadata WHERE key = ?")
      .get(TOMBSTONE_KEY_PREFIX + sessionUri) as { value: string } | undefined;
    if (meta?.value === "true") {
      return undefined;
    }
  }
  return toRow(dbRow) ?? undefined;
}

// provider_data is JSON text written by VS Code, so a row that does not hold an
// object with a usable sdkSessionId is skipped, never raised.
function readSdkSessionIdFromProviderData(providerData: unknown): string | null {
  if (typeof providerData !== "string") {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(providerData);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const sdkSessionId = (parsed as Record<string, unknown>).sdkSessionId;
  return typeof sdkSessionId === "string" && sdkSessionId !== "" ? sdkSessionId : null;
}

// The Copilot CLI's session id for an Agent Host session. It never equals the
// Agent Host id, so the chat row is the only link to the event log.
export function readAgentHostSdkSessionId(db: DatabaseSync, sessionUri: string): string | null {
  if (!hasTable(db, "chats_v2")) {
    return null;
  }
  // Rows without a chat_order sort last; rowid breaks ties in insertion order.
  const rows = db
    .prepare(
      "SELECT provider_data FROM chats_v2 WHERE owner_session_uri = ? " +
        "ORDER BY chat_order IS NULL, chat_order, rowid",
    )
    .all(sessionUri) as unknown as { provider_data: unknown }[];
  for (const row of rows) {
    const sdkSessionId = readSdkSessionIdFromProviderData(row.provider_data);
    if (sdkSessionId !== null) {
      return sdkSessionId;
    }
  }
  return null;
}
