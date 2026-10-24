import type {
  AuditRollup,
  AuditedToolCall,
  ConfigStatus,
  InsightsDataset,
  LogProviderStatus,
  ProductProfile,
  Session,
  SessionAudit,
  TurnInspectorDetail,
} from "@copilot-cost-analyzer/domain";
import type { AppSettingsStore } from "../../data-sources/log-providers/app-settings.js";
import type { LearnScenarioCatalog } from "../../data-sources/learn-scenarios/loader.js";
import type { LogProvider } from "../../data-sources/log-providers/log-provider.js";
import { UnknownLogProviderIdError } from "../../data-sources/log-providers/registry.js";
import {
  supportsSystemPromptText,
  type SystemPromptTextLookup,
} from "../../data-sources/log-providers/system-prompt-text-reader.js";
import type { SessionRangeFilter, ToolCallFilter } from "../tool-audit/audit-query-service.js";
import { parseSessionRangeQuery, parseToolCallFilterQuery } from "../tool-audit/audit-query-params.js";
import { BadRequestError, InternalError, NotFoundError } from "./api-errors.js";

// The narrow slices of the registry and query services ApiService needs
// (DIP) — each product's composition root passes its own registry, so
// ApiService never knows which product, or which providers, it runs with.
export interface ApiProviderRegistry {
  getActiveProvider(): LogProvider;
  setActive(providerId: string): void;
  getStatus(): Promise<LogProviderStatus>;
}

export interface ApiAuditQueries {
  getSessionAudit(sessionId: string, providerId?: string): Promise<SessionAudit | null>;
  listToolCalls(
    sessionId: string,
    filter: ToolCallFilter,
    providerId?: string,
  ): Promise<{ total: number; calls: AuditedToolCall[] } | null>;
  getRollup(filter: SessionRangeFilter): Promise<AuditRollup>;
}

export interface ApiInsights {
  getDataset(filter: SessionRangeFilter): Promise<InsightsDataset>;
}

// Checks the editor's settings against the given retention threshold
// (undefined: the check's own default).
export type ConfigStatusCheck = (minRetainedSessionLogsThreshold: number | undefined) => ConfigStatus;

export interface ApiServiceDeps {
  registry: ApiProviderRegistry;
  auditQueries: ApiAuditQueries;
  insights: ApiInsights;
  settings: Pick<AppSettingsStore, "readMinRetainedSessionLogsThreshold" | "writeMinRetainedSessionLogsThreshold">;
  checkConfig: ConfigStatusCheck;
  learnScenarios: LearnScenarioCatalog;
  appVersion: string;
  productProfile: ProductProfile;
}

// Query-string-shaped input (the HTTP adapter passes req.query as-is):
// ApiService parses it, so both transports validate the same way and
// report the same messages.
export type ApiQuery = Readonly<Record<string, unknown>>;

export interface HealthStatus {
  status: "ok";
  version: string;
}

function providerParam(query: ApiQuery): string | undefined {
  return typeof query.provider === "string" && query.provider.length > 0 ? query.provider : undefined;
}

// Turn indexes arrive as a path segment over HTTP and as a number over the
// webview RPC; both must be a non-negative integer.
function parseTurnIndex(raw: unknown): number {
  const turnIndex = typeof raw === "number" ? raw : typeof raw === "string" && raw !== "" ? Number(raw) : Number.NaN;
  if (!Number.isInteger(turnIndex) || turnIndex < 0) {
    throw new BadRequestError(`"${String(raw)}" is not a valid turn index.`);
  }
  return turnIndex;
}

function failure(what: string, error: unknown): InternalError {
  return new InternalError(`Failed to load ${what}: ${(error as Error).message}`, { cause: error });
}

// Audit and insights failures: an unknown ?provider= is the caller's
// mistake (400); anything else is a source failure (500).
function auditFailure(what: string, error: unknown): BadRequestError | InternalError {
  return error instanceof UnknownLogProviderIdError ? new BadRequestError(error.message) : failure(what, error);
}

// Transport-neutral implementation of the REST surface (vscode-extension.md
// D2, G1): the Express routes in app.ts and the extension's message
// dispatcher are thin adapters over this, so request validation, not-found
// handling and error wording live in exactly one place. Methods throw the
// typed errors in api-errors.ts; any other error is internal. Session reads
// go through the registry's active provider and never branch on which
// provider that is (Phase 9 exit criterion) — optional per-provider
// features are asked for as capabilities (SystemPromptTextReader).
export class ApiService {
  constructor(private readonly deps: ApiServiceDeps) {}

  async getHealth(): Promise<HealthStatus> {
    return { status: "ok", version: this.deps.appVersion };
  }

  async getProductProfile(): Promise<ProductProfile> {
    return this.deps.productProfile;
  }

  async getConfigStatus(): Promise<ConfigStatus> {
    return this.deps.checkConfig(this.deps.settings.readMinRetainedSessionLogsThreshold());
  }

  async setRetentionThreshold(value: unknown): Promise<ConfigStatus> {
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
      throw new BadRequestError('Request body must include a positive integer "value".');
    }
    this.deps.settings.writeMinRetainedSessionLogsThreshold(value);
    return this.getConfigStatus();
  }

  async listLearnScenarios(): Promise<Session[]> {
    return this.deps.learnScenarios.list();
  }

  async getLearnScenario(id: string): Promise<Session> {
    const scenario = this.deps.learnScenarios.get(id);
    if (!scenario) {
      throw new NotFoundError(`Unknown learn scenario id "${id}"`);
    }
    return scenario;
  }

  async getLogProviderStatus(): Promise<LogProviderStatus> {
    return this.deps.registry.getStatus();
  }

  async setActiveLogProvider(id: unknown): Promise<LogProviderStatus> {
    if (typeof id !== "string" || id.length === 0) {
      throw new BadRequestError('Request body must include a string "id".');
    }
    try {
      this.deps.registry.setActive(id);
    } catch (error) {
      if (error instanceof UnknownLogProviderIdError) {
        throw new BadRequestError(error.message);
      }
      throw error;
    }
    return this.deps.registry.getStatus();
  }

  // Session summaries (turns: []). A source failure propagates as-is.
  async listSessions(): Promise<Session[]> {
    return this.deps.registry.getActiveProvider().listSessions();
  }

  async getSession(sessionId: string): Promise<Session> {
    let session: Session | null;
    try {
      session = await this.deps.registry.getActiveProvider().readSession(sessionId);
    } catch (error) {
      throw failure(`session "${sessionId}"`, error);
    }
    if (!session) {
      throw new NotFoundError(`Unknown session id "${sessionId}"`);
    }
    return session;
  }

  // One turn's LLM request/response round-trip(s) (turn-inspector-plan.md
  // §5.6), fetched on demand since this content can be arbitrarily large.
  async getTurnDetail(sessionId: string, turnIndex: unknown): Promise<TurnInspectorDetail> {
    const index = parseTurnIndex(turnIndex);
    let detail: TurnInspectorDetail | null;
    try {
      detail = await this.deps.registry.getActiveProvider().readTurnDetail(sessionId, index);
    } catch (error) {
      throw failure(`turn ${index} for session "${sessionId}"`, error);
    }
    if (!detail) {
      throw new NotFoundError(`Unknown session id "${sessionId}" or turn index ${index}`);
    }
    return detail;
  }

  // Raw, uninterpreted text of the base system prompt captured for this
  // session — the "inspect as text file" counterpart to the estimated
  // token count in SystemPromptBreakdown. Only providers with the
  // SystemPromptTextReader capability have such an artifact (VS Code's
  // main.jsonl system_prompt file, pi-agent's in-file system messages or
  // sidecar log); for any other provider — mitmproxy, and claude-code,
  // which never writes its base prompt to disk (architecture.md §6.2.6) —
  // every session is unknown for this view.
  async getSystemPromptText(sessionId: string): Promise<string> {
    const provider = this.deps.registry.getActiveProvider();
    if (!supportsSystemPromptText(provider)) {
      throw new NotFoundError(`Unknown session id "${sessionId}"`);
    }
    let lookup: SystemPromptTextLookup;
    try {
      lookup = await provider.lookupSystemPromptText(sessionId);
    } catch (error) {
      throw failure(`system prompt for session "${sessionId}"`, error);
    }
    switch (lookup.status) {
      case "found":
        return lookup.text;
      case "not-captured":
        throw new NotFoundError(`No system-prompt artifact captured for session "${sessionId}"`);
      case "unknown-session":
        throw new NotFoundError(`Unknown session id "${sessionId}"`);
    }
  }

  // Tool-call audit (Phase 9.10, docs/plans/tool-call-audit.md) through the
  // same AuditQueryService the MCP server uses. An optional ?provider=
  // audits a provider other than the UI's active one.
  async getSessionAudit(sessionId: string, query: ApiQuery = {}): Promise<SessionAudit> {
    let audit: SessionAudit | null;
    try {
      audit = await this.deps.auditQueries.getSessionAudit(sessionId, providerParam(query));
    } catch (error) {
      throw auditFailure(`audit for session "${sessionId}"`, error);
    }
    if (!audit) {
      throw new NotFoundError(`Unknown session id "${sessionId}"`);
    }
    return audit;
  }

  async listToolCalls(
    sessionId: string,
    query: ApiQuery = {},
  ): Promise<{ total: number; calls: AuditedToolCall[] }> {
    const filter = parseToolCallFilterQuery(query);
    if (!filter.ok) {
      throw new BadRequestError(filter.error);
    }
    let result: { total: number; calls: AuditedToolCall[] } | null;
    try {
      result = await this.deps.auditQueries.listToolCalls(sessionId, filter.value, providerParam(query));
    } catch (error) {
      throw auditFailure(`tool calls for session "${sessionId}"`, error);
    }
    if (!result) {
      throw new NotFoundError(`Unknown session id "${sessionId}"`);
    }
    return result;
  }

  async getAuditRollup(query: ApiQuery = {}): Promise<AuditRollup> {
    const range = parseSessionRangeQuery(query);
    if (!range.ok) {
      throw new BadRequestError(range.error);
    }
    try {
      return await this.deps.auditQueries.getRollup(range.value);
    } catch (error) {
      throw auditFailure("audit rollup", error);
    }
  }

  // Insights dashboard (Phase 9.11, docs/plans/insights-dashboard.md): one
  // flat, redacted dataset across every registered provider (not just the
  // active one) plus findings. `limit` is per provider.
  async getInsights(query: ApiQuery = {}): Promise<InsightsDataset> {
    const range = parseSessionRangeQuery(query);
    if (!range.ok) {
      throw new BadRequestError(range.error);
    }
    try {
      return await this.deps.insights.getDataset(range.value);
    } catch (error) {
      throw auditFailure("insights", error);
    }
  }
}
