import { existsSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import type {
  Session,
  SystemPromptComponent,
  ToolInventoryEntry,
  TurnInspectorDetail,
  TurnUsage,
} from "@copilot-cost-analyzer/domain";
import {
  classifyEnvelopesAvailability,
  readMainJsonlFile,
  type MainJsonlAvailability,
} from "../../jsonl/main-jsonl-reader.js";
import { resolveMainJsonlPath } from "../../jsonl/session-log-path.js";
import {
  collectResponseIds,
  extractTurnUsages,
} from "../../jsonl/session-usage-spans.js";
import { readMainJsonlEnvelopesForTurn } from "../../jsonl/turn-inspector-reader.js";
import { buildTurnInspectorDetail } from "./turn-inspector-builder.js";
import { loadAgentTraceUsageForResponseIds } from "../../agent-traces/agent-traces-reader.js";
import {
  getSessionFileRows,
  getSessionRow,
  getTurnRows,
  listSessionRows,
  openReadOnlyDb,
  type SessionRow,
} from "../../sqlite/session-store.js";
import {
  buildAnalyzeModeExtras,
  resolveSystemPromptText,
} from "../../../services/session-enricher/analyze-mode-extras.js";
import {
  buildSession,
  buildSessionSummary,
  computeSessionCost,
} from "../../../services/session-enricher/session-enricher.js";
import type { LogProvider, LogProviderAvailability } from "../log-provider.js";
import type { SystemPromptTextLookup, SystemPromptTextReader } from "../system-prompt-text-reader.js";

export interface VscodeLogProviderOptions {
  sessionStoreDbPath: string | null;
  debugLogsDirPaths: string[];
  agentTracesDbPath: string | null;
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
// rather than leaving it as a parallel app.ts-level path).
export class VscodeLogProvider implements LogProvider, SystemPromptTextReader {
  readonly id = PROVIDER_ID;
  readonly label = "VS Code (local Copilot Chat)";

  constructor(private readonly options: VscodeLogProviderOptions) {}

  private openDb(): DatabaseSync | null {
    const { sessionStoreDbPath } = this.options;
    if (!sessionStoreDbPath || !existsSync(sessionStoreDbPath)) {
      return null;
    }
    return openReadOnlyDb(sessionStoreDbPath);
  }

  async checkAvailability(): Promise<LogProviderAvailability> {
    const db = this.openDb();
    if (!db) {
      return {
        available: false,
        unavailableReason:
          "No local GitHub Copilot Chat session store was found on this machine.",
      };
    }
    db.close();
    return { available: true };
  }

  // costAiCredits per session requires reading each session's main.jsonl (the
  // only source of AI Credits numbers) — an accurate list is worth an extra
  // file read per session for a local tool with a bounded session count. A
  // single session's read failing (corrupt/missing file) degrades that
  // session's cost to unavailable rather than failing the whole list.
  private async summarizeSessionWithCost(row: SessionRow): Promise<Session> {
    try {
      const mainJsonlPath = resolveMainJsonlPath(this.options.debugLogsDirPaths, row.id);
      let mainJsonlAvailability: MainJsonlAvailability = "missing";
      let turnUsages: (TurnUsage | null)[] = [];
      if (mainJsonlPath) {
        const { envelopes, rawLineCount } = await readMainJsonlFile(mainJsonlPath);
        mainJsonlAvailability = classifyEnvelopesAvailability(envelopes, rawLineCount);
        if (mainJsonlAvailability === "events-present") {
          turnUsages = extractTurnUsages(envelopes);
        }
      }
      return {
        ...buildSessionSummary(row, computeSessionCost(mainJsonlAvailability, turnUsages)),
        providerId: PROVIDER_ID,
      };
    } catch {
      return { ...buildSessionSummary(row), providerId: PROVIDER_ID };
    }
  }

  async listSessions(): Promise<Session[]> {
    const db = this.openDb();
    if (!db) {
      return [];
    }
    try {
      const rows = listSessionRows(db);
      return await Promise.all(rows.map((row) => this.summarizeSessionWithCost(row)));
    } finally {
      db.close();
    }
  }

  async readSession(sessionId: string): Promise<Session | null> {
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
      const mainJsonlPath = resolveMainJsonlPath(this.options.debugLogsDirPaths, sessionRow.id);

      let mainJsonlAvailability: MainJsonlAvailability = "missing";
      let turnUsages: (TurnUsage | null)[] = [];
      let invokedToolNamesByTurn: string[][] = [];
      let systemPrompt: SystemPromptComponent[] = [];
      let toolInventory: ToolInventoryEntry[] = [];
      if (mainJsonlPath) {
        const { envelopes, rawLineCount } = await readMainJsonlFile(mainJsonlPath);
        mainJsonlAvailability = classifyEnvelopesAvailability(envelopes, rawLineCount);
        if (mainJsonlAvailability === "events-present") {
          const agentTraceUsageByResponseId = loadAgentTraceUsageForResponseIds(
            this.options.agentTracesDbPath,
            collectResponseIds(envelopes),
          );
          turnUsages = extractTurnUsages(envelopes, agentTraceUsageByResponseId);
          ({ invokedToolNamesByTurn, systemPrompt, toolInventory } =
            await buildAnalyzeModeExtras(envelopes, mainJsonlPath));
        }
      }

      return {
        ...buildSession({
          sessionRow,
          turnRows,
          fileRows,
          mainJsonlAvailability,
          turnUsages,
          invokedToolNamesByTurn,
          systemPrompt,
          toolInventory,
        }),
        providerId: PROVIDER_ID,
      };
    } finally {
      db.close();
    }
  }

  // null has exactly one meaning here, matching readSession's null-for-404
  // convention: the session or the turn index doesn't exist per SQLite —
  // the ground truth for "does this turn exist" in this provider, decoupled
  // from whether main.jsonl happens to have round-trip data for it. A turn
  // that exists in SQLite but has no captured round-trip (session never
  // logged, or logging started after this turn ran) is a valid, non-null
  // TurnInspectorDetail with rounds: [].
  async readTurnDetail(sessionId: string, turnIndex: number): Promise<TurnInspectorDetail | null> {
    const db = this.openDb();
    if (!db) {
      return null;
    }

    try {
      const sessionRow = getSessionRow(db, sessionId);
      if (!sessionRow || turnIndex < 0 || turnIndex >= sessionRow.turn_count) {
        return null;
      }

      const mainJsonlPath = resolveMainJsonlPath(this.options.debugLogsDirPaths, sessionId);
      const result = mainJsonlPath
        ? await readMainJsonlEnvelopesForTurn(mainJsonlPath, turnIndex)
        : null;

      if (!result) {
        return { turnIndex, userMessage: [], rounds: [] };
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
    const db = this.openDb();
    if (!db) {
      return { status: "unknown-session" };
    }

    try {
      const sessionRow = getSessionRow(db, sessionId);
      if (!sessionRow) {
        return { status: "unknown-session" };
      }

      const mainJsonlPath = resolveMainJsonlPath(this.options.debugLogsDirPaths, sessionRow.id);
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
