// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import {
  apiMethodParamsSchemas,
  apiMethodSchema,
  rpcPerformanceMarkSchema,
  type ApiMethod,
  type PerformanceMarkName,
  type RpcCommandResponse,
  type RpcResponse,
} from "@agent-cost-analyzer/domain";
import type {
  ApiQuery,
  ApiService,
} from "@agent-cost-analyzer/server/src/services/api/api-service";
import {
  ApiError,
  statusForApiError,
} from "@agent-cost-analyzer/server/src/services/api/api-errors";
import type { RequestGate } from "../diagnostics/request-gate.js";
import { describeIssues } from "./describe-issues.js";

// The ApiService surface the webview may call (vscode-extension.md D2).
export type DispatcherApi = Pick<ApiService, ApiMethod>;

// Handles the webview's host commands (domain rpc.ts, G8); in the extension
// a HostCommandHandler (rpc/host-command-handler.ts).
export interface HostCommandSink {
  handle(message: {
    id: string;
    command?: unknown;
    args?: unknown;
  }): Promise<RpcCommandResponse>;
}

// Records the webview's timing marks (domain rpc.ts, perfMark); in the
// extension a PerformanceRecorder (performance/performance-recorder.ts).
export interface PerformanceMarkSink {
  recordWebviewMark(name: PerformanceMarkName, pageTimeMs: number): void;
}

export interface MessageDispatcherOptions {
  // Hears every error that isn't one of ApiService's typed errors; the
  // webview only ever gets a generic 500 for those.
  onInternalError?: (method: ApiMethod, error: unknown) => void;
  // Without it, every host command is answered with 400.
  hostCommands?: HostCommandSink;
  // Without it, timing marks are ignored.
  performanceMarks?: PerformanceMarkSink;
  // Without it, every method is answered at once; a test can hold chosen
  // methods back (diagnostics/request-gate.ts).
  requestGate?: RequestGate;
}

type Params = Record<string, unknown>;

const INTERNAL_ERROR_MESSAGE = "Internal error";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// A string param the method's schema (domain rpc.ts) has already required.
function stringParam(params: Params, key: string): string {
  return params[key] as string;
}

function optionalString(params: Params, key: string): string | undefined {
  return params[key] as string | undefined;
}

function optionalStringList(params: Params, key: string): string[] | undefined {
  return params[key] as string[] | undefined;
}

// The query fields exactly as the HTTP transport's query string carries
// them (http-transport.ts): lists comma-joined, everything else as text,
// undefined and "" left out — so ApiService parses the same input, and
// reports the same 400s, on both transports.
function toQuery(params: Params): ApiQuery {
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      query[key] = Array.isArray(value) ? value.join(",") : String(value);
    }
  }
  return query;
}

// `{ sessionId, ...filter }` (audit and tool calls) as (sessionId, query).
function sessionQuery(params: Params): [string, ApiQuery] {
  const { sessionId, ...query } = params;
  return [stringParam({ sessionId }, "sessionId"), toQuery(query)];
}

// Calls the ApiService method, with params under the keys the web
// transports use (packages/web/src/api-client/http-transport.ts). The
// params were already shape-checked against the method's schema, and
// ApiService's own validation covers the values.
function invoke(
  api: DispatcherApi,
  method: ApiMethod,
  params: Params,
): Promise<unknown> {
  switch (method) {
    case "listSessions":
      return api.listSessions();
    case "getSession":
      return api.getSession(stringParam(params, "id"));
    case "getTurnDetail":
      return api.getTurnDetail(
        stringParam(params, "sessionId"),
        params.turnIndex,
      );
    case "getSystemPromptText":
      return api.getSystemPromptText(stringParam(params, "id"));
    case "getConfigStatus":
      return api.getConfigStatus();
    case "setRetentionThreshold":
      return api.setRetentionThreshold(params.value);
    case "listLearnScenarios":
      return api.listLearnScenarios();
    case "getLearnScenario":
      return api.getLearnScenario(stringParam(params, "id"));
    case "getScenario":
      return api.getScenario(
        stringParam(params, "id"),
        optionalString(params, "modelId"),
      );
    case "compareScenario":
      return api.compareScenario(
        stringParam(params, "id"),
        optionalStringList(params, "modelIds"),
      );
    case "listVendorProfiles":
      return api.listVendorProfiles();
    case "getLogProviderStatus":
      return api.getLogProviderStatus();
    case "setActiveLogProvider":
      return api.setActiveLogProvider(params.id);
    case "getSessionAudit":
      return api.getSessionAudit(...sessionQuery(params));
    case "listToolCalls":
      return api.listToolCalls(...sessionQuery(params));
    case "getAuditRollup":
      return api.getAuditRollup(toQuery(params));
    case "getInsights":
      return api.getInsights(toQuery(params));
    case "getHealth":
      return api.getHealth();
    case "getProductProfile":
      return api.getProductProfile();
    // Step 15.9; answered over the Copilot sessions from step 15.14 (project
    // cost, statements, estimates and projects are 404: none in the extension).
    case "getCostTimeSeries":
      return api.getCostTimeSeries(toQuery(params));
    case "getCostComparison":
      return api.getCostComparison(toQuery(params));
    case "getProjectCost":
      return api.getProjectCost(toQuery(params));
    case "getCostVariance":
      return api.getCostVariance(toQuery(params));
    case "getStatement":
      return api.getStatement(toQuery(params));
    case "getProjects":
      return api.getProjects();
    case "saveProjects":
      return api.saveProjects((params as { file: unknown }).file);
    case "getRepositoryList":
      return api.getRepositoryList();
    case "getCostEstimate":
      return api.getCostEstimate(toQuery(params));
    case "issueStatement": {
      const { projectId, period } = params as { projectId: string; period: string };
      return api.issueStatement(projectId, period);
    }
  }
}

// The extension host's end of the webview RPC (vscode-extension.md §4,
// D1): validates each request's method against the domain's allow-list,
// calls ApiService, and maps its typed errors to the HTTP API's statuses.
// Host commands (G8) go to their own handler, never to ApiService, and a
// valid timing mark (perfMark) only to the performance recorder. The
// webview is untrusted content, so nothing else gets through and no
// internal error detail goes back to it.
//
// A `cancel` message (domain rpc.ts) makes the dispatcher forget a request
// that is still running: its reply, success or failure, is dropped, so
// nothing is posted for that id. The ApiService call itself isn't
// interrupted — it reads log files synchronously, so there is nothing to
// abort part-way — and its work simply finishes unheard.
export class MessageDispatcher {
  // Ids of the requests being answered, and the subset the webview cancelled.
  private readonly running = new Set<string>();
  private readonly cancelled = new Set<string>();

  constructor(
    private readonly api: DispatcherApi,
    private readonly options: MessageDispatcherOptions = {},
  ) {}

  // The reply to post back, or undefined for a message that is neither a
  // request nor a host command, for a cancel or a timing mark, and for a
  // cancelled request.
  // Commands never reach ApiService.
  async dispatch(
    message: unknown,
  ): Promise<RpcResponse | RpcCommandResponse | undefined> {
    if (isRecord(message) && message.kind === "perfMark") {
      this.recordPerformanceMark(message);
      return undefined;
    }
    if (!isRecord(message) || typeof message.id !== "string") {
      return undefined;
    }
    if (message.kind === "command") {
      const { id } = message;
      return this.options.hostCommands
        ? this.options.hostCommands.handle({ ...message, id })
        : failure(id, 400, "Host commands are not available");
    }
    if (message.kind === "cancel") {
      // Only a request still running is remembered, so a cancel that lost
      // the race with its reply doesn't suppress a later request with that id.
      if (this.running.has(message.id)) this.cancelled.add(message.id);
      return undefined;
    }
    if (message.kind !== "request") {
      return undefined;
    }
    const { id } = message;
    const method = apiMethodSchema.safeParse(message.method);
    if (!method.success) {
      return failure(id, 400, `Unknown method "${String(message.method)}"`);
    }
    // Only an absent params means "none"; null, arrays and scalars are malformed.
    const params = message.params === undefined ? {} : message.params;
    if (!isRecord(params)) {
      return failure(id, 400, "params must be an object");
    }
    const parsed = apiMethodParamsSchemas[method.data].safeParse(params);
    if (!parsed.success) {
      return failure(id, 400, describeInvalidParams(method.data, parsed.error));
    }
    this.running.add(id);
    try {
      // Awaited only when there is a gate, so production adds no tick.
      if (this.options.requestGate)
        await this.options.requestGate.waitFor(method.data);
      const reply = await this.answer(id, method.data, parsed.data as Params);
      return this.cancelled.has(id) ? undefined : reply;
    } finally {
      this.running.delete(id);
      this.cancelled.delete(id);
    }
  }

  // One-way, so a malformed mark is dropped without a reply.
  private recordPerformanceMark(message: unknown): void {
    const mark = rpcPerformanceMarkSchema.safeParse(message);
    if (mark.success) {
      this.options.performanceMarks?.recordWebviewMark(
        mark.data.name,
        mark.data.timeMs,
      );
    }
  }

  private async answer(
    id: string,
    method: ApiMethod,
    params: Params,
  ): Promise<RpcResponse> {
    try {
      return {
        kind: "response",
        id,
        ok: true,
        result: await invoke(this.api, method, params),
      };
    } catch (error) {
      if (error instanceof ApiError) {
        return failure(id, statusForApiError(error), error.message);
      }
      this.options.onInternalError?.(method, error);
      return failure(id, 500, INTERNAL_ERROR_MESSAGE);
    }
  }
}

function describeInvalidParams(
  method: ApiMethod,
  error: { issues: { path: PropertyKey[]; message: string }[] },
): string {
  return `Invalid params for ${method}: ${describeIssues(error.issues)}`;
}

function failure(
  id: string,
  status: 400 | 404 | 409 | 500,
  message: string,
): RpcResponse {
  return { kind: "response", id, ok: false, error: { status, message } };
}
