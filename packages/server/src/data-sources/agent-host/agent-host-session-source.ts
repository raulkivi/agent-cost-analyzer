import { existsSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import type { Session, TurnInspectorDetail } from "@agent-cost-analyzer/domain";
import {
  buildAgentHostSession,
  buildAgentHostSessionSummary,
  type AgentHostSessionStoreContents,
} from "../../services/session-enricher/agent-host-session-builder.js";
import type { LogProviderAvailability } from "../log-providers/log-provider.js";
import type { SystemPromptTextLookup } from "../log-providers/system-prompt-text-reader.js";
import type { CopilotSessionSource } from "../log-providers/vscode/copilot-session-source.js";
import { openReadOnlyDb } from "../sqlite/session-store.js";
import { getAgentHostSessionRow, listAgentHostSessionRows } from "./agent-host-catalog.js";
import { agentHostDbPath, agentSessionDbPath } from "./agent-host-paths.js";
import { readAgentHostSessionModel, readAgentHostSessionTitle, readAgentHostTurns } from "./agent-session-store.js";

export interface AgentHostSessionSourceOptions {
  // VS Code's user-data dir; both stores live under it (D4).
  userDataDir: string;
}

const UNAVAILABLE_REASON = "No VS Code Agent Host session catalog (User/globalStorage/agent-host.db) was found.";

// Read-only Copilot sessions from VS Code's Agent Host (step 10.13): the
// catalog in agent-host.db, and turns and usage from each session's own
// session.db. Both are opened per call, like the classic session store, so
// stores VS Code creates later are found without a restart.
export class AgentHostSessionSource implements CopilotSessionSource {
  constructor(private readonly options: AgentHostSessionSourceOptions) {}

  private openCatalog(): DatabaseSync | null {
    const dbPath = agentHostDbPath(this.options.userDataDir);
    return existsSync(dbPath) ? openReadOnlyDb(dbPath) : null;
  }

  private withCatalog<T>(read: (catalog: DatabaseSync) => T, whenMissing: T): T {
    const catalog = this.openCatalog();
    if (!catalog) {
      return whenMissing;
    }
    try {
      return read(catalog);
    } finally {
      catalog.close();
    }
  }

  // null when the session has no session.db; agentSessionDbPath also
  // refuses an id that isn't a safe path segment.
  private readStore(sessionId: string): AgentHostSessionStoreContents | null {
    const dbPath = agentSessionDbPath(this.options.userDataDir, sessionId);
    if (dbPath === null || !existsSync(dbPath)) {
      return null;
    }
    const db = openReadOnlyDb(dbPath);
    try {
      return {
        turns: readAgentHostTurns(db),
        model: readAgentHostSessionModel(db),
        title: readAgentHostSessionTitle(db),
      };
    } finally {
      db.close();
    }
  }

  // The list reads every session's store for its AI Credits; one unreadable
  // store degrades that session to unknown usage, as one unreadable
  // main.jsonl does on the classic path.
  private readStoreForList(sessionId: string): AgentHostSessionStoreContents | null {
    try {
      return this.readStore(sessionId);
    } catch {
      return null;
    }
  }

  async checkAvailability(): Promise<LogProviderAvailability> {
    return existsSync(agentHostDbPath(this.options.userDataDir))
      ? { available: true }
      : { available: false, unavailableReason: UNAVAILABLE_REASON };
  }

  // Chats opened but never sent have no turns and nothing to analyze, so
  // they're left out of every list (readSession still finds them by id).
  async listSessions(): Promise<Session[]> {
    return this.withCatalog(
      (catalog) =>
        listAgentHostSessionRows(catalog)
          .map((catalogRow) => buildAgentHostSessionSummary({ catalogRow, store: this.readStoreForList(catalogRow.id) }))
          .filter((summary) => summary.turnCount > 0),
      [],
    );
  }

  // Unlike the list, a store that can't be read rejects (the LogProvider
  // contract's source-level failure), so the session isn't shown as empty.
  async readSession(sessionId: string): Promise<Session | null> {
    const catalogRow = this.withCatalog((catalog) => getAgentHostSessionRow(catalog, sessionId), undefined);
    return catalogRow ? buildAgentHostSession({ catalogRow, store: this.readStore(sessionId) }) : null;
  }

  // The Agent Host keeps no request or response text, so an existing turn
  // has no round-trips (a non-null detail, per the LogProvider contract).
  async readTurnDetail(sessionId: string, turnIndex: number): Promise<TurnInspectorDetail | null> {
    const catalogRow = this.withCatalog((catalog) => getAgentHostSessionRow(catalog, sessionId), undefined);
    if (!catalogRow) {
      return null;
    }
    const turnCount = this.readStore(sessionId)?.turns.length ?? 0;
    if (!Number.isInteger(turnIndex) || turnIndex < 0 || turnIndex >= turnCount) {
      return null;
    }
    return { turnIndex, userMessage: [], rounds: [] };
  }

  async lookupSystemPromptText(sessionId: string): Promise<SystemPromptTextLookup> {
    const known = this.withCatalog((catalog) => getAgentHostSessionRow(catalog, sessionId) !== undefined, false);
    return known ? { status: "not-captured" } : { status: "unknown-session" };
  }
}
