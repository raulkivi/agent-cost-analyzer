// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { existsSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import type {
  RequestTrace,
  Session,
  SystemPromptComponent,
  ToolInventoryEntry,
  TurnInspectorDetail,
} from "@agent-cost-analyzer/domain";
import { classifyEnvelopesAvailability, readMainJsonlFile } from "../../jsonl/main-jsonl-reader.js";
import { readClassicUsage } from "../../jsonl/classic-usage-reader.js";
import { resolveMainJsonlPath } from "../../jsonl/session-log-path.js";
import { collectResponseIds } from "../../jsonl/session-usage-spans.js";
import { readMainJsonlEnvelopesForTurn } from "../../jsonl/turn-inspector-reader.js";
import { buildTurnInspectorDetail } from "./turn-inspector-builder.js";
import { loadAgentTraceUsageForResponseIds } from "../../agent-traces/agent-traces-reader.js";
import {
  getSessionFileRows,
  getSessionRow,
  getTurnRows,
  listSessionRows,
  listTurnsBySession,
  openReadOnlyDb,
  type SessionRow,
  type TurnKeyRow,
  type TurnRow,
} from "../../sqlite/session-store.js";
import {
  alignLogTurnsToStore,
  logTurnDigests,
  placeByStoreIndex,
  storeTurnKeys,
} from "../../jsonl/log-turn-alignment.js";
import {
  buildAnalyzeModeExtras,
  resolveSystemPromptText,
} from "../../../services/session-enricher/analyze-mode-extras.js";
import {
  buildSession,
  buildSessionSummary,
  summarizeSessionUsage,
} from "../../../services/session-enricher/session-enricher.js";
import type { LogProvider, LogProviderAvailability, RequestTraceReader } from "../log-provider.js";
import { buildLocalRequestTrace } from "../../jsonl/local-request-trace.js";
import type { SystemPromptTextLookup, SystemPromptTextReader } from "../system-prompt-text-reader.js";
import type { CopilotSessionSource } from "./copilot-session-source.js";

export interface VscodeLogProviderOptions {
  sessionStoreDbPath: string | null;
  // The per-workspace debug-logs folders. A function is asked on every
  // lookup, so a host can add workspaces opened after startup (the
  // extension's Refresh) without rebuilding the provider.
  debugLogsDirPaths: string[] | (() => string[]);
  agentTracesDbPath: string | null;
  // VS Code's Agent Host sessions (step 10.13), listed next to the classic
  // store's; omitted or null means none.
  agentHostSessions?: CopilotSessionSource | null;
}

const CLASSIC_UNAVAILABLE_REASON = "No local GitHub Copilot Chat session store was found on this machine.";

// Newest start first across both stores; a session without a start goes
// last. Array.prototype.sort is stable, so ties keep each store's order.
function byStartDescending(a: Session, b: Session): number {
  return (b.startedAt ?? "").localeCompare(a.startedAt ?? "");
}

const PROVIDER_ID = "vscode";

// Adapts the existing SQLite session store + main.jsonl parsing +
// session-enricher (Phases 3-6) and the optional agent-traces.db enrichment
// (Phase 8.5) behind the LogProvider contract. This is a refactor of that
// existing, already-tested code — app.ts's route handlers used to call
// these same modules directly; now they go through this adapter instead, so
// that adding a second provider (mitmproxy) doesn't require touching the
// route layer (architecture.md §6.2.1/§4.1's Phase 9 row, and the
// 2026-08-10 decision to fold Phase 8.5's agent-traces.db read in here
// rather than leaving it as a parallel app.ts-level path). Since step 10.13
// it also lists the sessions of a second Copilot store (VS Code's Agent
// Host), injected as a CopilotSessionSource: ids are UUIDs in both stores,
// so each lookup asks the classic store first and the second store only for
// an id the classic store doesn't have.
export class VscodeLogProvider implements LogProvider, SystemPromptTextReader, RequestTraceReader {
  readonly id = PROVIDER_ID;
  readonly label = "VS Code (local Copilot Chat)";

  constructor(private readonly options: VscodeLogProviderOptions) {}

  private debugLogsDirPaths(): string[] {
    const { debugLogsDirPaths } = this.options;
    return typeof debugLogsDirPaths === "function" ? debugLogsDirPaths() : debugLogsDirPaths;
  }

  private openDb(): DatabaseSync | null {
    const { sessionStoreDbPath } = this.options;
    if (!sessionStoreDbPath || !existsSync(sessionStoreDbPath)) {
      return null;
    }
    return openReadOnlyDb(sessionStoreDbPath);
  }

  private get agentHostSessions(): CopilotSessionSource | null {
    return this.options.agentHostSessions ?? null;
  }

  private tag(session: Session): Session {
    return { ...session, providerId: PROVIDER_ID };
  }

  // Available when either store can be read; with neither, the classic
  // store's reason, which the setup guidance is written around.
  async checkAvailability(): Promise<LogProviderAvailability> {
    const db = this.openDb();
    if (db) {
      db.close();
      return { available: true };
    }
    if ((await this.agentHostSessions?.checkAvailability())?.available) {
      return { available: true };
    }
    return { available: false, unavailableReason: CLASSIC_UNAVAILABLE_REASON };
  }

  // costAiCredits per session requires reading each session's main.jsonl (the
  // only source of AI Credits numbers) — an accurate list is worth an extra
  // file read per session for a local tool with a bounded session count. The
  // figures come from summarizeSessionUsage, as readSession's do, so the list
  // and the detail agree. A single session's read failing (corrupt/missing
  // file) degrades that session's cost to unavailable rather than failing
  // the whole list.
  private async summarizeSessionWithCost(row: SessionRow, storeTurns: TurnKeyRow[]): Promise<Session> {
    try {
      const usage = await readClassicUsage({
        mainJsonlPath: resolveMainJsonlPath(this.debugLogsDirPaths(), row.id),
        storeTurns,
      });
      const storeTurnIndices = storeTurns.map((turn) => turn.turn_index);
      return {
        ...buildSessionSummary(
          row,
          summarizeSessionUsage(usage.availability, storeTurnIndices, usage.turnUsages, usage.attribution),
        ),
        providerId: PROVIDER_ID,
      };
    } catch {
      return { ...buildSessionSummary(row), providerId: PROVIDER_ID };
    }
  }

  async listSessions(): Promise<Session[]> {
    const [classic, agentHost] = await Promise.all([
      this.listClassicSessions(),
      this.agentHostSessions?.listSessions() ?? [],
    ]);
    return [...classic, ...agentHost.map((session) => this.tag(session))].sort(byStartDescending);
  }

  private async listClassicSessions(): Promise<Session[]> {
    const db = this.openDb();
    if (!db) {
      return [];
    }
    try {
      const rows = listSessionRows(db);
      const turnsBySession = listTurnsBySession(db);
      return await Promise.all(
        rows.map((row) => this.summarizeSessionWithCost(row, turnsBySession.get(row.id) ?? [])),
      );
    } finally {
      db.close();
    }
  }

  async readSession(sessionId: string): Promise<Session | null> {
    const classic = await this.readClassicSession(sessionId);
    if (classic) {
      return classic;
    }
    const agentHost = await this.agentHostSessions?.readSession(sessionId);
    return agentHost ? this.tag(agentHost) : null;
  }

  private async readClassicSession(sessionId: string): Promise<Session | null> {
    const db = this.openDb();
    if (!db) {
      return null;
    }

    try {
      const sessionRow = getSessionRow(db, sessionId);
      if (!sessionRow) {
        return null;
      }

      const turnRows = getTurnRows(db, sessionRow.id);
      const fileRows = getSessionFileRows(db, sessionRow.id);
      const mainJsonlPath = resolveMainJsonlPath(this.debugLogsDirPaths(), sessionRow.id);

      const usage = await readClassicUsage({
        mainJsonlPath,
        storeTurns: turnRows,
        agentTracesDbPath: this.options.agentTracesDbPath,
      });
      let invokedToolNamesByTurn: string[][] = [];
      let systemPrompt: SystemPromptComponent[] = [];
      let toolInventory: ToolInventoryEntry[] = [];
      if (mainJsonlPath && usage.availability === "events-present") {
        const extras = await buildAnalyzeModeExtras(usage.envelopes, mainJsonlPath);
        ({ systemPrompt, toolInventory } = extras);
        invokedToolNamesByTurn = placeByStoreIndex(extras.invokedToolNamesByTurn, usage.alignment);
      }

      return {
        ...buildSession({
          sessionRow,
          turnRows,
          fileRows,
          mainJsonlAvailability: usage.availability,
          turnUsages: usage.turnUsages,
          invokedToolNamesByTurn,
          systemPrompt,
          toolInventory,
          subagentRuns: usage.attribution,
        }),
        providerId: PROVIDER_ID,
      };
    } finally {
      db.close();
    }
  }

  // Phase 14 step 14.2: the per-request trace a replay reads, from the
  // classic store first, then Agent Host (as readSession).
  async readRequestTrace(sessionId: string): Promise<RequestTrace | null> {
    const classic = await this.readClassicRequestTrace(sessionId);
    if (classic !== "unknown-session") {
      return classic;
    }
    return (await this.agentHostSessions?.readRequestTrace?.(sessionId)) ?? null;
  }

  // The same reads and alignment as readClassicSession, so the trace's turn
  // indexes are the session's: the store's rows and the placed log turns.
  private async readClassicRequestTrace(sessionId: string): Promise<RequestTrace | "unknown-session"> {
    const db = this.openDb();
    if (!db) {
      return "unknown-session";
    }
    try {
      const sessionRow = getSessionRow(db, sessionId);
      if (!sessionRow) {
        return "unknown-session";
      }
      const turnRows = getTurnRows(db, sessionRow.id);
      const mainJsonlPath = resolveMainJsonlPath(this.debugLogsDirPaths(), sessionRow.id);
      const envelopes = mainJsonlPath ? (await readMainJsonlFile(mainJsonlPath)).envelopes : [];
      const alignment = alignLogTurnsToStore(logTurnDigests(envelopes), storeTurnKeys(turnRows));
      const placed = alignment.filter((index): index is number => index !== null);
      return buildLocalRequestTrace({
        sessionId: sessionRow.id,
        envelopes,
        alignment,
        sessionTurnIndexes: [...turnRows.map((row) => row.turn_index), ...placed],
        agentTraceUsage: loadAgentTraceUsageForResponseIds(this.options.agentTracesDbPath, collectResponseIds(envelopes)),
      });
    } finally {
      db.close();
    }
  }

  // null has exactly one meaning here, matching readSession's null-for-404
  // convention: the session or the turn index doesn't exist. A turn exists
  // when SQLite has it or when main.jsonl has it (a debug-log turn the store
  // has no row for, which readSession lists too). A turn that exists in
  // SQLite but has no captured round-trip (session never logged, or logging
  // started after this turn ran) is a valid, non-null TurnInspectorDetail
  // with rounds: [].
  async readTurnDetail(sessionId: string, turnIndex: number): Promise<TurnInspectorDetail | null> {
    const classic = await this.readClassicTurnDetail(sessionId, turnIndex);
    if (classic !== "unknown-session") {
      return classic;
    }
    return (await this.agentHostSessions?.readTurnDetail(sessionId, turnIndex)) ?? null;
  }

  // The position among main.jsonl's user_messages of the log turn that is
  // store turn `turnIndex` (readSession's join), or null when the log has no
  // such turn or cannot place it with certainty.
  private async findLogTurnIndex(mainJsonlPath: string, turnRows: TurnRow[], turnIndex: number): Promise<number | null> {
    const { envelopes } = await readMainJsonlFile(mainJsonlPath);
    const alignment = alignLogTurnsToStore(logTurnDigests(envelopes), storeTurnKeys(turnRows));
    const logTurnIndex = alignment.indexOf(turnIndex);
    return logTurnIndex === -1 ? null : logTurnIndex;
  }

  // "unknown-session" when the classic store has no such session, so only
  // then is the second store asked; null is a classic session's missing turn.
  private async readClassicTurnDetail(
    sessionId: string,
    turnIndex: number,
  ): Promise<TurnInspectorDetail | null | "unknown-session"> {
    const db = this.openDb();
    if (!db) {
      return "unknown-session";
    }

    try {
      const sessionRow = getSessionRow(db, sessionId);
      if (!sessionRow) {
        return "unknown-session";
      }
      if (!Number.isInteger(turnIndex) || turnIndex < 0) {
        return null;
      }

      const mainJsonlPath = resolveMainJsonlPath(this.debugLogsDirPaths(), sessionId);
      const logTurnIndex = mainJsonlPath
        ? await this.findLogTurnIndex(mainJsonlPath, getTurnRows(db, sessionId), turnIndex)
        : null;
      const result =
        mainJsonlPath && logTurnIndex !== null
          ? await readMainJsonlEnvelopesForTurn(mainJsonlPath, logTurnIndex)
          : null;

      if (!result) {
        // Beyond the store's turns, only a debug-log turn exists (readSession's turn set).
        return turnIndex < sessionRow.turn_count ? { turnIndex, userMessage: [], rounds: [] } : null;
      }

      return buildTurnInspectorDetail(turnIndex, result.turnEnvelopes, result.previousInputMessagesLength);
    } finally {
      db.close();
    }
  }

  // Raw, uninterpreted text of the base system prompt captured for this
  // session (the SystemPromptTextReader capability, vscode-extension.md G1)
  // — the "inspect as text file" counterpart to the estimated token count
  // in SystemPromptBreakdown, read from the system_prompt artifact
  // main.jsonl points to. Moved here from app.ts's route unchanged: SQLite
  // decides whether the session exists, and a known session without a
  // main.jsonl or without that artifact is not-captured.
  async lookupSystemPromptText(sessionId: string): Promise<SystemPromptTextLookup> {
    const classic = await this.lookupClassicSystemPromptText(sessionId);
    if (classic.status !== "unknown-session" || !this.agentHostSessions) {
      return classic;
    }
    return this.agentHostSessions.lookupSystemPromptText(sessionId);
  }

  private async lookupClassicSystemPromptText(sessionId: string): Promise<SystemPromptTextLookup> {
    const db = this.openDb();
    if (!db) {
      return { status: "unknown-session" };
    }

    try {
      const sessionRow = getSessionRow(db, sessionId);
      if (!sessionRow) {
        return { status: "unknown-session" };
      }

      const mainJsonlPath = resolveMainJsonlPath(this.debugLogsDirPaths(), sessionRow.id);
      if (!mainJsonlPath) {
        return { status: "not-captured" };
      }
      const { envelopes, rawLineCount } = await readMainJsonlFile(mainJsonlPath);
      if (classifyEnvelopesAvailability(envelopes, rawLineCount) !== "events-present") {
        return { status: "not-captured" };
      }
      const text = await resolveSystemPromptText(envelopes, mainJsonlPath);
      return text === null ? { status: "not-captured" } : { status: "found", text };
    } finally {
      db.close();
    }
  }
}
