// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type {
  AuditRollup,
  AuditedToolCall,
  ConfigStatus,
  CostComparison,
  CostVariance,
  CostEstimate,
  StatementAnswer,
  ProjectCost,
  PriceChangeList,
  CostSeries,
  InsightsDataset,
  LogProviderStatus,
  PriceBookListing,
  ProductProfile,
  ProjectsState,
  RepositoryList,
  Session,
  SessionAudit,
  SessionReplay,
  SessionReplayComparison,
  TurnInspectorDetail,
  VendorComparison,
  VendorProfileSummary,
} from "@agent-cost-analyzer/domain";
import { z } from "zod";
import type { AppSettingsStore } from "../../data-sources/log-providers/app-settings.js";
import { ProjectsFileRejectedError, type ProjectCatalog } from "../cost-attribution/project-catalog.js";
import { buildProjectsFileWarning } from "../cost-attribution/projects-file-warning.js";
import type { LearnScenarioCatalog } from "../learn-simulation/learn-scenario-catalog.js";
import type { LogProvider } from "../../data-sources/log-providers/log-provider.js";
import { UnknownLogProviderIdError } from "../../data-sources/log-providers/registry.js";
import {
  supportsSystemPromptText,
  type SystemPromptTextLookup,
} from "../../data-sources/log-providers/system-prompt-text-reader.js";
import { ScenarioNotFoundError, UnknownModelError } from "../learn-simulation/learn-simulation-service.js";
import type { SessionRangeFilter, ToolCallFilter } from "../tool-audit/audit-query-service.js";
import { isoDateBoundSchema, parseSessionRangeQuery, parseToolCallFilterQuery } from "../tool-audit/audit-query-params.js";
import { BadRequestError, ConflictError, InternalError, NotFoundError } from "./api-errors.js";
import { StatementAlreadyIssuedError } from "../../data-sources/statements/file-statement-store.js";
import {
  AlreadyIssuedError,
  PeriodNotEndedError,
  UnknownStatementPeriodError,
  UnknownStatementProjectError,
  type StatementQueries,
  type StatementRequest,
} from "../billing/statement-service.js";
import { parseEstimateQuery, type EstimateQueries } from "../billing/estimate-service.js";
import type { PriceBookReader } from "../pricing/price-book.js";
import type { CostAnalysisQueries } from "../cost-analysis/cost-analysis-service.js";
import { TooManyComparedModelsError, type ReplayResult, type SessionReplayQueries } from "../session-replay/session-replay-service.js";
import { parseCompareQuery, parseReplayQuery } from "../session-replay/replay-query-params.js";
import { parseCostCompareQuery, parseCostSeriesQuery, parseCostVarianceQuery, parsePriceChangesQuery, parseProjectCostQuery } from "../cost-analysis/cost-query-params.js";

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

// The simulator slice ApiService needs (ISP); it throws
// ScenarioNotFoundError / UnknownModelError, mapped to 404 / 400 below.
export interface ApiLearnSimulation {
  getScenario(id: string, modelId?: string): Session;
  compareScenario(id: string, modelIds?: string[]): VendorComparison;
  listVendorProfiles(): VendorProfileSummary[];
}

// Checks the editor's settings against the given retention threshold
// (undefined: the check's own default).
export type ConfigStatusCheck = (minRetainedSessionLogsThreshold: number | undefined) => ConfigStatus;

// Phase 15 step 15.3: the projects file and the repository list. Optional:
// a product without them (the extension, until step 15.14) answers 404.
export interface ApiProjects {
  catalog: Pick<ProjectCatalog, "load" | "save">;
  repositories: { getRepositoryList(): Promise<RepositoryList> };
}

export const PROJECTS_UNAVAILABLE_MESSAGE = "Projects are not available in this product.";

// Phase 15 step 15.5: the price book. Optional like projects: the extension
// has none yet and answers 404.
export const PRICE_BOOK_UNAVAILABLE_MESSAGE = "The price book is not available in this product.";

const priceBookQuerySchema = z.object({
  channel: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  at: isoDateBoundSchema.optional(),
});

// Phase 15 step 15.7: cost over time and compare. Optional like the price
// book: the extension has none yet and answers 404.
export const COST_ANALYSIS_UNAVAILABLE_MESSAGE = "Cost analyses are not available in this product.";
export const ESTIMATES_UNAVAILABLE_MESSAGE = "Estimates are not available in this product.";
export const STATEMENTS_UNAVAILABLE_MESSAGE = "Billing statements are not available in this product.";
// Phase 14 step 14.5: session replay. Optional like the price book: a
// product without a price book can't price a replay and answers 404.
export const SESSION_REPLAY_UNAVAILABLE_MESSAGE = "Session replay is not available in this product.";

export interface ApiServiceDeps {
  registry: ApiProviderRegistry;
  projects?: ApiProjects;
  priceBook?: PriceBookReader;
  costAnalysis?: Pick<CostAnalysisQueries, "getTimeSeries" | "compare" | "explainChange" | "getPriceChanges" | "getProjectCost">;
  // Phase 15 step 15.11: billing statements (the standalone app; the
  // extension gets them with step 15.14).
  statements?: StatementQueries;
  // Phase 15 step 15.12: estimates (the standalone app; the extension with 15.14).
  estimates?: EstimateQueries;
  // Phase 14 step 14.5: a session replayed on another model (both products, D5).
  sessionReplay?: SessionReplayQueries;
  auditQueries: ApiAuditQueries;
  insights: ApiInsights;
  settings: Pick<AppSettingsStore, "readMinRetainedSessionLogsThreshold" | "writeMinRetainedSessionLogsThreshold">;
  checkConfig: ConfigStatusCheck;
  learnScenarios: LearnScenarioCatalog;
  learnSimulation: ApiLearnSimulation;
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

function optionalModelId(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") throw new BadRequestError('"modelId" must be a string.');
  return raw;
}

function optionalModelIds(raw: unknown): string[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.some((id) => typeof id !== "string")) {
    throw new BadRequestError('"modelIds" must be an array of strings.');
  }
  return raw as string[];
}

// Maps the simulator's typed failures to the API's; anything else stays internal.
function simulate<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof ScenarioNotFoundError) throw new NotFoundError(error.message);
    if (error instanceof UnknownModelError) throw new BadRequestError(error.message);
    throw failure("the simulated scenario", error);
  }
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
    const status = this.deps.checkConfig(this.deps.settings.readMinRetainedSessionLogsThreshold());
    const projectsWarning = this.deps.projects ? buildProjectsFileWarning(this.deps.projects.catalog.load()) : null;
    return projectsWarning ? { ...status, warnings: [...status.warnings, projectsWarning] } : status;
  }

  private requireProjects(): ApiProjects {
    if (!this.deps.projects) {
      throw new NotFoundError(PROJECTS_UNAVAILABLE_MESSAGE);
    }
    return this.deps.projects;
  }

  async getProjects(): Promise<ProjectsState> {
    return this.requireProjects().catalog.load();
  }

  // Strict: a file with any problem is rejected whole and nothing is
  // written; the problems go back beside the error for inline display.
  async saveProjects(candidate: unknown): Promise<ProjectsState> {
    const { catalog } = this.requireProjects();
    try {
      return catalog.save(candidate);
    } catch (error) {
      if (error instanceof ProjectsFileRejectedError) {
        throw new BadRequestError(error.message, { problems: error.problems });
      }
      throw error;
    }
  }

  async getRepositoryList(): Promise<RepositoryList> {
    return this.requireProjects().repositories.getRepositoryList();
  }

  // GET /api/price-book?channel&model&at (plan §10): the same listing the
  // get_price_book MCP tool returns.
  async getPriceBook(query: ApiQuery): Promise<PriceBookListing> {
    if (!this.deps.priceBook) throw new NotFoundError(PRICE_BOOK_UNAVAILABLE_MESSAGE);
    const parsed = priceBookQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
    }
    return this.deps.priceBook.list(parsed.data);
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

  async getScenario(id: string, modelId?: unknown): Promise<Session> {
    const model = optionalModelId(modelId);
    return simulate(() => this.deps.learnSimulation.getScenario(id, model));
  }

  async compareScenario(id: string, modelIds?: unknown): Promise<VendorComparison> {
    const models = optionalModelIds(modelIds);
    return simulate(() => this.deps.learnSimulation.compareScenario(id, models));
  }

  async listVendorProfiles(): Promise<VendorProfileSummary[]> {
    return simulate(() => this.deps.learnSimulation.listVendorProfiles());
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

  // Phase 15 step 15.7 (plan §10): GET /api/cost/timeseries and
  // /api/cost/compare, over the same builders as the MCP cost tools.
  async getCostTimeSeries(query: ApiQuery = {}): Promise<CostSeries> {
    const analysis = this.costAnalysis();
    const parsed = parseCostSeriesQuery(query);
    if (!parsed.ok) throw new BadRequestError(parsed.error);
    try {
      return await analysis.getTimeSeries(parsed.value);
    } catch (error) {
      throw auditFailure("cost time series", error);
    }
  }

  async getCostComparison(query: ApiQuery = {}): Promise<CostComparison> {
    const analysis = this.costAnalysis();
    const parsed = parseCostCompareQuery(query);
    if (!parsed.ok) throw new BadRequestError(parsed.error);
    try {
      return await analysis.compare(parsed.value);
    } catch (error) {
      throw auditFailure("cost comparison", error);
    }
  }

  // Step 15.11 (plan §8.5): a project's statement for a period, the draft or
  // the frozen copy with the re-run's diff.
  async getStatement(query: ApiQuery = {}): Promise<StatementAnswer> {
    const statements = this.statementQueries();
    const request = statementRequestOf(query);
    const answer = await this.statementCall(() => statements.get(request));
    if (answer === null) throw new NotFoundError(`Unknown project id "${request.projectId}"`);
    return answer;
  }

  // Step 15.11 (plan §8.5, D15): freezes the draft; writes a file.
  async issueStatement(projectId: unknown, period: unknown): Promise<StatementAnswer> {
    const statements = this.statementQueries();
    const request = statementRequestOf({ projectId, period });
    return this.statementCall(() => statements.issue(request));
  }

  // Step 15.12 (plan §8.6): GET /api/estimates, as MCP estimate_cost.
  async getCostEstimate(query: ApiQuery = {}): Promise<CostEstimate> {
    if (!this.deps.estimates) throw new NotFoundError(ESTIMATES_UNAVAILABLE_MESSAGE);
    const parsed = parseEstimateQuery(query);
    if (!parsed.ok) throw new BadRequestError(parsed.error);
    let estimate: CostEstimate | null;
    try {
      estimate = await this.deps.estimates.estimate(parsed.value);
    } catch (error) {
      throw auditFailure("estimate", error);
    }
    if (estimate === null) throw new NotFoundError(`Unknown project id "${"projectId" in parsed.value ? parsed.value.projectId : ""}"`);
    return estimate;
  }

  // Phase 14 step 14.5 (plan §9): GET /api/sessions/:id/replay?model&pricing&provider,
  // the session as it would have run on another model (always simulated).
  async getSessionReplay(sessionId: string, query: ApiQuery = {}): Promise<SessionReplay> {
    const replays = this.sessionReplays();
    const parsed = parseReplayQuery(query);
    if (!parsed.ok) throw new BadRequestError(parsed.error);
    return replayAnswer(sessionId, () => replays.replay({ sessionId, ...parsed.value }));
  }

  // GET /api/sessions/:id/replay/compare?models&pricing&provider: the
  // session's total on each model (its own included), with coverage.
  async compareSessionReplay(sessionId: string, query: ApiQuery = {}): Promise<SessionReplayComparison> {
    const replays = this.sessionReplays();
    const parsed = parseCompareQuery(query);
    if (!parsed.ok) throw new BadRequestError(parsed.error);
    return replayAnswer(sessionId, () => replays.compare({ sessionId, ...parsed.value }));
  }

  private sessionReplays(): SessionReplayQueries {
    if (!this.deps.sessionReplay) throw new NotFoundError(SESSION_REPLAY_UNAVAILABLE_MESSAGE);
    return this.deps.sessionReplay;
  }

  private statementQueries(): StatementQueries {
    if (!this.deps.statements) throw new NotFoundError(STATEMENTS_UNAVAILABLE_MESSAGE);
    return this.deps.statements;
  }

  private async statementCall<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof UnknownStatementPeriodError) throw new BadRequestError(error.message);
      if (error instanceof UnknownStatementProjectError) throw new NotFoundError(error.message);
      if (error instanceof PeriodNotEndedError || error instanceof AlreadyIssuedError || error instanceof StatementAlreadyIssuedError) throw new ConflictError(error.message);
      throw auditFailure("statement", error);
    }
  }

  // Step 15.10 (plan §11.4): the Project tab's breakdown, as get_project_cost.
  async getProjectCost(query: ApiQuery = {}): Promise<ProjectCost> {
    const analysis = this.costAnalysis();
    const parsed = parseProjectCostQuery(query);
    if (!parsed.ok) throw new BadRequestError(parsed.error);
    let cost: ProjectCost | null;
    try {
      cost = await analysis.getProjectCost(parsed.value);
    } catch (error) {
      throw auditFailure("project cost", error);
    }
    if (cost === null) throw new NotFoundError(`Unknown project id "${parsed.value.projectId}"`);
    return cost;
  }

  // Step 15.10 (plan §8.4, §10): usage, price and mix effects between two periods.
  async getCostVariance(query: ApiQuery = {}): Promise<CostVariance> {
    const analysis = this.costAnalysis();
    const parsed = parseCostVarianceQuery(query);
    if (!parsed.ok) throw new BadRequestError(parsed.error);
    try {
      return await analysis.explainChange(parsed.value);
    } catch (error) {
      throw auditFailure("cost variance", error);
    }
  }

  // Step 15.10 (plan §6.4): documented and observed price changes.
  async getPriceChanges(query: ApiQuery = {}): Promise<PriceChangeList> {
    const analysis = this.costAnalysis();
    const parsed = parsePriceChangesQuery(query);
    if (!parsed.ok) throw new BadRequestError(parsed.error);
    try {
      return await analysis.getPriceChanges(parsed.value);
    } catch (error) {
      throw auditFailure("price changes", error);
    }
  }

  private costAnalysis(): NonNullable<ApiServiceDeps["costAnalysis"]> {
    if (!this.deps.costAnalysis) throw new NotFoundError(COST_ANALYSIS_UNAVAILABLE_MESSAGE);
    return this.deps.costAnalysis;
  }
}

// Phase 14 step 14.5: the replay service's statuses as the API's errors.
// A model no vendor profile lists, or too many models, is the caller's
// mistake (400). A session that exists but can't be replayed (a provider
// without request traces, an empty trace, one over the 20,000-request
// limit) answers 404 with the reason, as a session without a captured
// system prompt does: the replay asked for doesn't exist, and the error set
// both transports share has no 422.
async function replayAnswer<T>(sessionId: string, call: () => Promise<ReplayResult<T>>): Promise<T> {
  let result: ReplayResult<T>;
  try {
    result = await call();
  } catch (error) {
    if (error instanceof TooManyComparedModelsError) throw new BadRequestError(error.message);
    throw auditFailure(`replay of session "${sessionId}"`, error);
  }
  switch (result.status) {
    case "ok":
      return result.value;
    case "unknown-session":
      throw new NotFoundError(`Unknown session id "${sessionId}"`);
    case "unknown-model":
      throw new BadRequestError(result.reason);
    case "not-replayable":
      throw new NotFoundError(result.reason);
  }
}

// Step 15.11: GET /api/statements?projectId&period&provider&limit.
function statementRequestOf(query: Readonly<Record<string, unknown>>): StatementRequest {
  const text = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : undefined);
  const projectId = text(query.projectId);
  const period = text(query.period);
  if (projectId === undefined) throw new BadRequestError("projectId is required.");
  if (period === undefined) throw new BadRequestError("period is required: a month as YYYY-MM or a range as YYYY-MM-DD..YYYY-MM-DD.");
  const provider = text(query.provider);
  const limit = text(query.limit);
  if (limit !== undefined && !/^\d+$/.test(limit)) throw new BadRequestError("limit must be a whole number.");
  return { projectId, period, ...(provider !== undefined ? { providerId: provider } : {}), ...(limit !== undefined ? { limit: Number(limit) } : {}) };
}
