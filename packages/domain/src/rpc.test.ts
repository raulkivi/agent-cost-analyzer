import { describe, expect, it } from "vitest";
import * as domain from "./index.js";
import {
  apiMethodSchema,
  apiMethodParamsSchemas,
  hostEventNameSchema,
  rpcRequestSchema,
  type HostEvent,
  type RpcResponse,
} from "./rpc.js";

describe("apiMethodSchema", () => {
  it("lists every ApiService method the transports share (vscode-extension.md D2)", () => {
    expect(apiMethodSchema.options).toEqual([
      "listSessions",
      "getSession",
      "getTurnDetail",
      "getSystemPromptText",
      "getConfigStatus",
      "setRetentionThreshold",
      "listLearnScenarios",
      "getLearnScenario",
      "getLogProviderStatus",
      "setActiveLogProvider",
      "getSessionAudit",
      "listToolCalls",
      "getAuditRollup",
      "getInsights",
      "getHealth",
      "getProductProfile",
    ]);
  });

  it("accepts a known method name", () => {
    expect(apiMethodSchema.parse("getSession")).toBe("getSession");
  });

  it("rejects an unknown method name", () => {
    expect(() => apiMethodSchema.parse("deleteEverything")).toThrow();
  });

  it("is exported from the domain index", () => {
    expect(domain.apiMethodSchema).toBe(apiMethodSchema);
  });
});

describe("apiMethodParamsSchemas (vscode-extension.md §4)", () => {
  it("has a params schema for every method", () => {
    expect(Object.keys(apiMethodParamsSchemas).sort()).toEqual([...apiMethodSchema.options].sort());
  });

  it.each(["getSession", "getSystemPromptText", "getLearnScenario"] as const)("%s requires a non-empty string id", (method) => {
    const schema = apiMethodParamsSchemas[method];

    expect(schema.safeParse({ id: "s1" }).success).toBe(true);
    for (const bad of [{}, { id: 7 }, { id: "" }, { id: null }]) {
      expect(schema.safeParse(bad).success).toBe(false);
    }
  });

  it.each(["getTurnDetail", "getSessionAudit", "listToolCalls"] as const)("%s requires a non-empty string sessionId", (method) => {
    const schema = apiMethodParamsSchemas[method];

    expect(schema.safeParse({ sessionId: "s1", turnIndex: 0 }).success).toBe(true);
    for (const bad of [{ turnIndex: 0 }, { sessionId: 7, turnIndex: 0 }, { sessionId: "", turnIndex: 0 }]) {
      expect(schema.safeParse(bad).success).toBe(false);
    }
  });

  it("leaves the turn index, retention value and provider id to ApiService, which owns those messages", () => {
    expect(apiMethodParamsSchemas.getTurnDetail.safeParse({ sessionId: "s1" }).success).toBe(true);
    expect(apiMethodParamsSchemas.getTurnDetail.safeParse({ sessionId: "s1", turnIndex: "x" }).success).toBe(true);
    expect(apiMethodParamsSchemas.setRetentionThreshold.safeParse({ value: -1 }).success).toBe(true);
    expect(apiMethodParamsSchemas.setRetentionThreshold.safeParse({}).success).toBe(true);
    expect(apiMethodParamsSchemas.setActiveLogProvider.safeParse({ id: 5 }).success).toBe(true);
  });

  it("accepts the tool-call query fields the way the web transport sends them", () => {
    const parsed = apiMethodParamsSchemas.listToolCalls.parse({
      sessionId: "s1",
      status: ["failed", "denied"],
      category: ["timeout"],
      tool: "run_in_terminal",
      kind: [],
      program: "git",
      turn: 3,
      offset: 0,
      limit: 25,
      provider: "vscode",
    });

    expect(parsed).toMatchObject({ sessionId: "s1", status: ["failed", "denied"], turn: 3, limit: 25 });
  });

  it("accepts range query fields as text or numbers, and absent fields", () => {
    for (const method of ["getAuditRollup", "getInsights"] as const) {
      const schema = apiMethodParamsSchemas[method];
      expect(schema.safeParse({}).success).toBe(true);
      expect(schema.safeParse({ since: "2026-01-01", until: "2026-02-01", limit: 10, provider: "vscode" }).success).toBe(true);
      expect(schema.safeParse({ limit: "10", since: undefined }).success).toBe(true);
    }
  });

  it.each([
    ["getAuditRollup", { since: 5 }],
    ["getAuditRollup", { limit: { n: 1 } }],
    ["getInsights", { until: null }],
    ["getInsights", { provider: ["a"] }],
    ["listToolCalls", { sessionId: "s1", status: [1] }],
    ["listToolCalls", { sessionId: "s1", tool: ["a"] }],
    ["listToolCalls", { sessionId: "s1", turn: null }],
  ] as const)("%s rejects mistyped query field %j", (method, params) => {
    expect(apiMethodParamsSchemas[method].safeParse(params).success).toBe(false);
  });

  it.each(["listSessions", "getConfigStatus", "listLearnScenarios", "getLogProviderStatus", "getHealth", "getProductProfile"] as const)(
    "%s takes no params",
    (method) => {
      expect(apiMethodParamsSchemas[method].safeParse({}).success).toBe(true);
    },
  );

  it("is exported from the domain index", () => {
    expect(domain.apiMethodParamsSchemas).toBe(apiMethodParamsSchemas);
  });
});

describe("rpcRequestSchema, RpcResponse and HostEvent (vscode-extension.md §4)", () => {
  it("accepts a request with a known method and any params", () => {
    expect(rpcRequestSchema.safeParse({ kind: "request", id: "r1", method: "getSession", params: { id: "s" } }).success).toBe(true);
    expect(rpcRequestSchema.safeParse({ kind: "request", id: "r1", method: "getHealth" }).success).toBe(true);
  });

  it.each([
    { kind: "request", method: "getHealth" },
    { kind: "request", id: 1, method: "getHealth" },
    { kind: "request", id: "r1", method: "nope" },
    { kind: "event", name: "configChanged" },
  ])("rejects the malformed request %j", (message) => {
    expect(rpcRequestSchema.safeParse(message).success).toBe(false);
  });

  it("names the host events", () => {
    expect(hostEventNameSchema.options).toEqual(["configChanged", "themeChanged", "selectSession"]);
  });

  it("types a response and an event", () => {
    const ok: RpcResponse = { kind: "response", id: "r1", ok: true, result: 1 };
    const failed: RpcResponse = { kind: "response", id: "r1", ok: false, error: { status: 404, message: "no" } };
    const event: HostEvent = { kind: "event", name: "configChanged" };

    expect([ok.ok, failed.ok, event.name]).toEqual([true, false, "configChanged"]);
  });
});
