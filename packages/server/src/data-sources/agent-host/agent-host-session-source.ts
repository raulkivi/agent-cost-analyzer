import { existsSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import type { Session, TurnInspectorDetail } from "@agent-cost-analyzer/domain";
import { lookupAgentHostSystemPromptText } from "../../services/session-enricher/agent-host-system-prompt-builder.js";
import {
  buildAgentHostSession,
  buildAgentHostSessionSummary,
  buildAgentHostTurnDetail,
  isAgentHostEventTypeUsed,
  type AgentHostEventLog,
  type AgentHostSessionStoreContents,
} from "../../services/session-enricher/agent-host-session-builder.js";
import type { LogProviderAvailability } from "../log-providers/log-provider.js";
import type { SystemPromptTextLookup } from "../log-providers/system-prompt-text-reader.js";
import type { CopilotSessionSource } from "../log-providers/vscode/copilot-session-source.js";
import { openReadOnlyDb } from "../sqlite/session-store.js";
import { getAgentHostSessionRow, listAgentHostSessionRows, readAgentHostSdkSessionId, type AgentHostSessionRow } from "./agent-host-catalog.js";
import { agentHostDbPath, agentSessionDbPath } from "./agent-host-paths.js";
import {
  readAgentHostSessionModel,
  readAgentHostSessionTitle,
  readAgentHostTurnEventIds,
  readAgentHostTurns,
  type AgentHostTurnEventRef,
} from "./agent-session-store.js";
import { copilotEventLogPath } from "./copilot-cli-paths.js";
import { CopilotEventLogCache, statEventLogFile, type CopilotEventLogLoad } from "./copilot-event-log-cache.js";
import { readCopilotEventLog } from "./copilot-event-log-reader.js";

// Loads one parsed event log; CopilotEventLogCache is the real one.
export interface CopilotEventLogLoader {
  load(filePath: string): Promise<CopilotEventLogLoad>;
}

export interface AgentHostSessionSourceOptions {
  // VS Code's user-data dir; both stores live under it (D4).
  userDataDir: string;
  // The Copilot CLI's home (resolveCopilotHome), where each session's event
  // log lives (step 10.14); null reads no log.
  copilotHome: string | null;
  // Defaults to a bounded cache over the streaming reader, parsing only the
  // event types the builders use.
  eventLogs?: CopilotEventLogLoader;
}

const UNAVAILABLE_REASON = "No VS Code Agent Host session catalog (User/globalStorage/agent-host.db) was found.";

const LOG_LOCATION = "session-state/<id>/events.jsonl in the Copilot home, ~/.copilot by default";
export const AGENT_HOST_EVENT_LOG_NO_HOME_REASON =
  "No Copilot CLI home is configured, so this Agent Host session's event log isn't read and its turn text, tool calls and system prompt are unknown.";
export const AGENT_HOST_NO_SDK_SESSION_ID_REASON =
  "VS Code's Agent Host recorded no usable Copilot CLI session id for this session (agent-host.db chats_v2), so its event log can't be found and its turn text, tool calls and system prompt are unknown.";
export const AGENT_HOST_EVENT_LOG_MISSING_REASON = `This session's Copilot CLI event log (${LOG_LOCATION}) is missing, so its turn text, tool calls and system prompt are unknown.`;
export const AGENT_HOST_EVENT_LOG_UNREADABLE_REASON = `This session's Copilot CLI event log (${LOG_LOCATION}) couldn't be read, so its turn text, tool calls and system prompt are unknown.`;

function unreadableReason(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === "string" ? `${AGENT_HOST_EVENT_LOG_UNREADABLE_REASON} (${code})` : AGENT_HOST_EVENT_LOG_UNREADABLE_REASON;
}

function defaultEventLogs(): CopilotEventLogLoader {
  return new CopilotEventLogCache({
    read: (filePath) => readCopilotEventLog(filePath, { include: isAgentHostEventTypeUsed }),
    stat: statEventLogFile,
  });
}

function readStoreContents(db: DatabaseSync): AgentHostSessionStoreContents {
  return { turns: readAgentHostTurns(db), model: readAgentHostSessionModel(db), title: readAgentHostSessionTitle(db) };
}

// The catalog's view of one session: its row, and the Copilot CLI session id
// that names its event log.
interface CatalogEntry {
  row: AgentHostSessionRow;
  sdkSessionId: string | null;
}

// Read-only Copilot sessions from VS Code's Agent Host (steps 10.13 and
// 10.14): the catalog in agent-host.db, turns and usage from each session's
// own session.db, and turn text, tool calls and the system prompt from the
// Copilot CLI's event log. The stores are opened per call, like the classic
// session store, so stores VS Code creates later are found without a
// restart; the log is read only for one session at a time, never to list.
export class AgentHostSessionSource implements CopilotSessionSource {
  private readonly eventLogs: CopilotEventLogLoader;

  constructor(private readonly options: AgentHostSessionSourceOptions) {
    this.eventLogs = options.eventLogs ?? defaultEventLogs();
  }

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

  private findInCatalog(sessionId: string): CatalogEntry | undefined {
    return this.withCatalog((catalog) => {
      const row = getAgentHostSessionRow(catalog, sessionId);
      return row ? { row, sdkSessionId: readAgentHostSdkSessionId(catalog, row.sessionUri) } : undefined;
    }, undefined);
  }

  // null when the session has no session.db; agentSessionDbPath also
  // refuses an id that isn't a safe path segment.
  private withStore<T>(sessionId: string, read: (db: DatabaseSync) => T): T | null {
    const dbPath = agentSessionDbPath(this.options.userDataDir, sessionId);
    if (dbPath === null || !existsSync(dbPath)) {
      return null;
    }
    const db = openReadOnlyDb(dbPath);
    try {
      return read(db);
    } finally {
      db.close();
    }
  }

  private readStore(sessionId: string): AgentHostSessionStoreContents | null {
    return this.withStore(sessionId, readStoreContents);
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

  // Never rejects: the log only adds text, tool calls and the system prompt,
  // so a log that can't be read leaves them unknown with a reason, and the
  // session's tokens and AI Credits still show.
  private async loadEventLog(sdkSessionId: string | null, turnRefs: AgentHostTurnEventRef[]): Promise<AgentHostEventLog> {
    if (this.options.copilotHome === null) {
      return { status: "missing", reason: AGENT_HOST_EVENT_LOG_NO_HOME_REASON };
    }
    const logPath = sdkSessionId === null ? null : copilotEventLogPath(this.options.copilotHome, sdkSessionId);
    if (logPath === null) {
      return { status: "missing", reason: AGENT_HOST_NO_SDK_SESSION_ID_REASON };
    }
    let loaded: CopilotEventLogLoad;
    try {
      loaded = await this.eventLogs.load(logPath);
    } catch (error) {
      loaded = { status: "unreadable", error };
    }
    switch (loaded.status) {
      case "read":
        return { status: "read", events: loaded.log.events, turnRefs };
      case "missing":
        return { status: "missing", reason: AGENT_HOST_EVENT_LOG_MISSING_REASON };
      case "unreadable":
        return { status: "unreadable", reason: unreadableReason(loaded.error) };
    }
  }

  async checkAvailability(): Promise<LogProviderAvailability> {
    return existsSync(agentHostDbPath(this.options.userDataDir))
      ? { available: true }
      : { available: false, unavailableReason: UNAVAILABLE_REASON };
  }

  // Chats opened but never sent (a session.db that was read and holds no
  // turns) have nothing to analyze, so they're left out of every list
  // (readSession still finds them by id). A missing or unreadable session.db
  // stays listed with unknown usage: unknown is shown, never hidden (constraint 6).
  // No event log is opened here: listing stays cheap however large the logs.
  async listSessions(): Promise<Session[]> {
    return this.withCatalog(
      (catalog) =>
        listAgentHostSessionRows(catalog).flatMap((catalogRow) => {
          const store = this.readStoreForList(catalogRow.id);
          return store !== null && store.turns.length === 0 ? [] : [buildAgentHostSessionSummary({ catalogRow, store })];
        }),
      [],
    );
  }

  // Unlike the list, a store that can't be read rejects (the LogProvider
  // contract's source-level failure), so the session isn't shown as empty.
  async readSession(sessionId: string): Promise<Session | null> {
    const entry = this.findInCatalog(sessionId);
    if (!entry) {
      return null;
    }
    const read = this.withStore(sessionId, (db) => ({ store: readStoreContents(db), turnRefs: readAgentHostTurnEventIds(db) }));
    const eventLog = await this.loadEventLog(entry.sdkSessionId, read?.turnRefs ?? []);
    return buildAgentHostSession({ catalogRow: entry.row, store: read?.store ?? null, eventLog });
  }

  // session.db decides whether the turn exists, so the log is opened only for
  // a real turn.
  async readTurnDetail(sessionId: string, turnIndex: number): Promise<TurnInspectorDetail | null> {
    const entry = this.findInCatalog(sessionId);
    if (!entry) {
      return null;
    }
    const turnRefs = this.withStore(sessionId, readAgentHostTurnEventIds) ?? [];
    if (!Number.isInteger(turnIndex) || turnIndex < 0 || turnIndex >= turnRefs.length) {
      return null;
    }
    return buildAgentHostTurnDetail(turnIndex, await this.loadEventLog(entry.sdkSessionId, turnRefs));
  }

  async lookupSystemPromptText(sessionId: string): Promise<SystemPromptTextLookup> {
    const entry = this.findInCatalog(sessionId);
    if (!entry) {
      return { status: "unknown-session" };
    }
    const eventLog = await this.loadEventLog(entry.sdkSessionId, []);
    return eventLog.status === "read" ? lookupAgentHostSystemPromptText(eventLog.events) : { status: "not-captured" };
  }
}
