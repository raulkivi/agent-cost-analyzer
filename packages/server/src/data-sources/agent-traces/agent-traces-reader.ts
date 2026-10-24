import { DatabaseSync } from "node:sqlite";

// agent-traces.db schema (confirmed against a real capture — see
// docs/copilot-chat-source-investigation.md §5d/§5f): reasoning_tokens is a
// denormalized column on `spans`, but cache-creation is not — it only
// exists as a raw `gen_ai.usage.*` attribute in `span_attributes`, alongside
// the `gen_ai.response.id` join key back to main.jsonl's responseId.
const RESPONSE_ID_ATTR_KEY = "gen_ai.response.id";
const CACHE_CREATION_ATTR_KEY = "gen_ai.usage.cache_creation.input_tokens";

export interface AgentTraceUsage {
  cacheWrite: number;
  reasoning: number;
}

export function openAgentTracesDbReadOnly(dbPath: string): DatabaseSync {
  return new DatabaseSync(dbPath, { readOnly: true });
}

interface AgentTraceUsageRow {
  response_id: string;
  reasoning_tokens: number | null;
  cache_write: string | null;
}

// A responseId with no matching row simply isn't a key in the returned map
// — that absence is the "unavailable" signal session-usage-spans.ts uses,
// never fabricated as a 0 (constraint 6).
export function getAgentTraceUsageByResponseIds(
  db: DatabaseSync,
  responseIds: string[],
): Map<string, AgentTraceUsage> {
  const result = new Map<string, AgentTraceUsage>();
  if (responseIds.length === 0) {
    return result;
  }

  const placeholders = responseIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT resp.value AS response_id, s.reasoning_tokens AS reasoning_tokens, cache.value AS cache_write
       FROM spans s
       JOIN span_attributes resp ON resp.span_id = s.span_id AND resp.key = ?
       LEFT JOIN span_attributes cache ON cache.span_id = s.span_id AND cache.key = ?
       WHERE s.operation_name = 'chat' AND resp.value IN (${placeholders})`,
    )
    .all(RESPONSE_ID_ATTR_KEY, CACHE_CREATION_ATTR_KEY, ...responseIds) as unknown as AgentTraceUsageRow[];

  for (const row of rows) {
    result.set(row.response_id, {
      // Absent cache-creation attribute is a legitimate 0 (this request
      // didn't cache-write), not unavailable — mirrors llm-request-
      // extractor.ts's existing `cachedTokens ?? 0` treatment.
      cacheWrite: row.cache_write !== null ? Number(row.cache_write) : 0,
      reasoning: row.reasoning_tokens ?? 0,
    });
  }

  return result;
}

// Orchestration entry point app.ts calls. Unlike session-store.ts (load-
// bearing, allowed to throw), this data source is explicitly optional — a
// missing, locked, or corrupt db degrades to an empty map (constraint 6's
// "unavailable, not fabricated"), never fails the whole request.
export function loadAgentTraceUsageForResponseIds(
  dbPath: string | null,
  responseIds: string[],
): Map<string, AgentTraceUsage> {
  if (dbPath === null) {
    return new Map();
  }

  let db: DatabaseSync | undefined;
  try {
    db = openAgentTracesDbReadOnly(dbPath);
    return getAgentTraceUsageByResponseIds(db, responseIds);
  } catch {
    return new Map();
  } finally {
    db?.close();
  }
}
