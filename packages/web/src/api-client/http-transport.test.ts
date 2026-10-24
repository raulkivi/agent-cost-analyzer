import { describe, expect, it, vi } from "vitest";
import { HttpTransport } from "./http-transport.js";
import { describeApiTransportContract, type ContractHarness } from "./transport-contract.js";
import type { ApiMethodName } from "./transport.js";

type FetchInit = { method?: string; headers?: Record<string, string>; body?: string };

// A fetch stand-in that records its calls and answers with one fixed outcome.
function fakeFetch(status = 200, value: unknown = {}) {
  const calls: Array<[string, FetchInit | undefined]> = [];
  const impl = (url: string, init?: FetchInit) => {
    calls.push([url, init]);
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(value),
      text: () => Promise.resolve(String(value)),
    });
  };
  return { calls, impl: impl as unknown as typeof fetch };
}

function harness(): ContractHarness {
  let outcome = { status: 200, value: {} as unknown };
  let hangingImpl: typeof fetch | undefined;
  const impl = ((url: string, init?: FetchInit) =>
    hangingImpl
      ? hangingImpl(url, init as never)
      : fakeFetch(outcome.status, outcome.value).impl(url as never, init as never)) as unknown as typeof fetch;
  return {
    transport: new HttpTransport(impl),
    succeedWith: (value) => {
      outcome = { status: 200, value };
    },
    failWith: (status) => {
      outcome = { status, value: undefined };
    },
    hang: () => {
      // Like fetch: pending until its signal aborts, then an AbortError.
      hangingImpl = ((_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          const abort = () => reject(new DOMException("aborted", "AbortError"));
          if (init?.signal?.aborted) abort();
          init?.signal?.addEventListener("abort", abort);
        })) as unknown as typeof fetch;
    },
  };
}

describeApiTransportContract("HttpTransport", harness);

describe("HttpTransport URL mapping", () => {
  const cases: Array<[ApiMethodName, unknown, string, string?, unknown?]> = [
    ["listSessions", undefined, "/api/sessions"],
    ["getSession", { id: "session-1" }, "/api/sessions/session-1"],
    ["getTurnDetail", { sessionId: "session-1", turnIndex: 2 }, "/api/sessions/session-1/turns/2"],
    ["getSystemPromptText", { id: "session-1" }, "/api/sessions/session-1/system-prompt"],
    ["getConfigStatus", undefined, "/api/config/status"],
    ["setRetentionThreshold", { value: 300 }, "/api/config/retention-threshold", "PUT", { value: 300 }],
    ["listLearnScenarios", undefined, "/api/learn/scenarios"],
    ["getLearnScenario", { id: "cache-basics" }, "/api/learn/scenarios/cache-basics"],
    ["getLogProviderStatus", undefined, "/api/log-providers"],
    ["setActiveLogProvider", { id: "mitmproxy" }, "/api/log-providers/active", "PUT", { id: "mitmproxy" }],
    ["getSessionAudit", { sessionId: "a/b" }, "/api/sessions/a%2Fb/audit"],
    ["listToolCalls", { sessionId: "s1" }, "/api/sessions/s1/tool-calls"],
    [
      "listToolCalls",
      { sessionId: "s1", status: ["failed", "denied"], category: ["timeout"], tool: "bash", turn: 0, limit: 5, provider: "vscode" },
      "/api/sessions/s1/tool-calls?status=failed%2Cdenied&category=timeout&tool=bash&turn=0&limit=5&provider=vscode",
    ],
    ["getAuditRollup", {}, "/api/audit"],
    ["getAuditRollup", { since: "2026-09-01", until: "", limit: 100 }, "/api/audit?since=2026-09-01&limit=100"],
    ["getInsights", {}, "/api/insights"],
    ["getInsights", { since: "2026-09-11", limit: 200 }, "/api/insights?since=2026-09-11&limit=200"],
    ["getHealth", undefined, "/api/health"],
    ["getProductProfile", undefined, "/api/product"],
  ];

  it.each(cases)("%s %j -> %s", async (method, params, url, verb, body) => {
    const { calls, impl } = fakeFetch();
    await new HttpTransport(impl).call(method, params);
    expect(calls).toHaveLength(1);
    const [calledUrl, init] = calls[0];
    expect(calledUrl).toBe(url);
    if (verb) {
      expect(init).toEqual({
        method: verb,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      // Plain GETs keep passing no init, exactly as http.ts always did.
      expect(init).toBeUndefined();
    }
  });

  it("hands the signal to fetch, with the PUT's own init when it has one", async () => {
    const controller = new AbortController();
    const get = fakeFetch();
    await new HttpTransport(get.impl).call("getInsights", {}, controller.signal);
    expect(get.calls[0][1]).toEqual({ signal: controller.signal });

    const put = fakeFetch();
    await new HttpTransport(put.impl).call("setRetentionThreshold", { value: 300 }, controller.signal);
    expect(put.calls[0][1]).toEqual({
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: 300 }),
      signal: controller.signal,
    });
  });

  it("names the failing URL in the error, as http.ts always did", async () => {
    const { impl } = fakeFetch(500);
    await expect(new HttpTransport(impl).call("getSession", { id: "x" })).rejects.toThrow(
      "Request to /api/sessions/x failed with status 500",
    );
  });

  it("defaults to the global fetch", async () => {
    const stub = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
    vi.stubGlobal("fetch", stub);
    try {
      await new HttpTransport().call("listSessions");
      expect(stub).toHaveBeenCalledWith("/api/sessions");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
