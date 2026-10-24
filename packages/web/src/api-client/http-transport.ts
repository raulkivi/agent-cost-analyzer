import type { ApiMethodName, ApiTransport } from "./transport.js";

type FetchLike = typeof fetch;

interface HttpRequest {
  url: string;
  // Absent for a plain GET, which passes no init to fetch.
  put?: unknown;
  text?: boolean;
}

// Params are plain objects (see each case below); anything not named here is
// ignored, except the query-string methods, which pass every field through.
type Params = Record<string, unknown>;

// Builds `?a=b&c=d` from the fields that are set. Arrays become comma lists
// (the server's list filters), and undefined / "" fields are left out.
function queryString(params: Params): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      search.set(key, Array.isArray(value) ? value.join(",") : String(value));
    }
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

// Today's REST routes (packages/server/src/app.ts). Ids are interpolated
// unencoded except where the routes always encoded them (audit, tool calls).
function toRequest(method: ApiMethodName, params: unknown): HttpRequest {
  const p = (params ?? {}) as Params;
  switch (method) {
    case "listSessions":
      return { url: "/api/sessions" };
    case "getSession": // { id }
      return { url: `/api/sessions/${String(p.id)}` };
    case "getTurnDetail": // { sessionId, turnIndex }
      return { url: `/api/sessions/${String(p.sessionId)}/turns/${String(p.turnIndex)}` };
    case "getSystemPromptText": // { id }
      return { url: `/api/sessions/${String(p.id)}/system-prompt`, text: true };
    case "getConfigStatus":
      return { url: "/api/config/status" };
    case "setRetentionThreshold": // { value }
      return { url: "/api/config/retention-threshold", put: { value: p.value } };
    case "listLearnScenarios":
      return { url: "/api/learn/scenarios" };
    case "getLearnScenario": // { id }
      return { url: `/api/learn/scenarios/${String(p.id)}` };
    case "getLogProviderStatus":
      return { url: "/api/log-providers" };
    case "setActiveLogProvider": // { id }
      return { url: "/api/log-providers/active", put: { id: p.id } };
    case "getSessionAudit": // { sessionId }
      return { url: `/api/sessions/${encodeURIComponent(String(p.sessionId))}/audit` };
    case "listToolCalls": {
      // { sessionId, status?, category?, tool?, kind?, program?, turn?, offset?, limit?, provider? }
      const { sessionId, ...filter } = p;
      return { url: `/api/sessions/${encodeURIComponent(String(sessionId))}/tool-calls${queryString(filter)}` };
    }
    case "getAuditRollup": // { since?, until?, limit?, provider? }
      return { url: `/api/audit${queryString(p)}` };
    case "getInsights": // { since?, until?, limit? }
      return { url: `/api/insights${queryString(p)}` };
    case "getHealth":
      return { url: "/api/health" };
    case "getProductProfile":
      return { url: "/api/product" };
  }
}

// ApiTransport over the standalone server's REST API. This is the only
// module in the web package that touches `fetch`.
export class HttpTransport implements ApiTransport {
  // `fetchImpl` is injectable for tests; the default resolves the global at
  // call time so a test's stubbed fetch is honoured.
  constructor(private readonly fetchImpl: FetchLike = (...args) => fetch(...args)) {}

  async call<T>(method: ApiMethodName, params?: unknown, signal?: AbortSignal): Promise<T> {
    const request = toRequest(method, params);
    // A plain GET passes no init at all unless there is a signal to hand on.
    const signalInit = signal ? { signal } : undefined;
    const response =
      request.put === undefined
        ? signalInit
          ? await this.fetchImpl(request.url, signalInit)
          : await this.fetchImpl(request.url)
        : await this.fetchImpl(request.url, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request.put),
            ...signalInit,
          });
    if (!response.ok) {
      throw new Error(`Request to ${request.url} failed with status ${response.status}`);
    }
    return (request.text ? response.text() : response.json()) as Promise<T>;
  }
}
