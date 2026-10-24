import { apiMethodParamsSchemas, apiMethodSchema, type ApiMethod, type RpcResponse } from "@copilot-cost-analyzer/domain";
import type { ApiQuery, ApiService } from "@copilot-cost-analyzer/server/src/services/api/api-service";
import { ApiError, statusForApiError } from "@copilot-cost-analyzer/server/src/services/api/api-errors";

// The ApiService surface the webview may call (vscode-extension.md D2).
export type DispatcherApi = Pick<ApiService, ApiMethod>;

export interface MessageDispatcherOptions {
  // Hears every error that isn't one of ApiService's typed errors; the
  // webview only ever gets a generic 500 for those.
  onInternalError?: (method: ApiMethod, error: unknown) => void;
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
function invoke(api: DispatcherApi, method: ApiMethod, params: Params): Promise<unknown> {
  switch (method) {
    case "listSessions":
      return api.listSessions();
    case "getSession":
      return api.getSession(stringParam(params, "id"));
    case "getTurnDetail":
      return api.getTurnDetail(stringParam(params, "sessionId"), params.turnIndex);
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
  }
}

// The extension host's end of the webview RPC (vscode-extension.md §4,
// D1): validates each request's method against the domain's allow-list,
// calls ApiService, and maps its typed errors to the HTTP API's statuses.
// The webview is untrusted content, so nothing else gets through and no
// internal error detail goes back to it.
export class MessageDispatcher {
  constructor(
    private readonly api: DispatcherApi,
    private readonly options: MessageDispatcherOptions = {},
  ) {}

  // The reply to post back, or undefined for a message that isn't a request.
  async dispatch(message: unknown): Promise<RpcResponse | undefined> {
    if (!isRecord(message) || message.kind !== "request" || typeof message.id !== "string") {
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
    try {
      return { kind: "response", id, ok: true, result: await invoke(this.api, method.data, parsed.data as Params) };
    } catch (error) {
      if (error instanceof ApiError) {
        return failure(id, statusForApiError(error), error.message);
      }
      this.options.onInternalError?.(method.data, error);
      return failure(id, 500, INTERNAL_ERROR_MESSAGE);
    }
  }
}

function describeInvalidParams(method: ApiMethod, error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  const issues = error.issues.map((issue) => (issue.path.length > 0 ? `${issue.path.map(String).join(".")}: ${issue.message}` : issue.message));
  return `Invalid params for ${method}: ${issues.join("; ")}`;
}

function failure(id: string, status: 400 | 404 | 500, message: string): RpcResponse {
  return { kind: "response", id, ok: false, error: { status, message } };
}
