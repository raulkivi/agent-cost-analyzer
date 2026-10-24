import { describe, expect, it } from "vitest";
import * as domain from "./index.js";
import {
  apiMethodSchema,
  apiMethodParamsSchemas,
  hostCommandArgsSchemas,
  hostCommandSchema,
  hostEventNameSchema,
  MAX_HOST_COMMAND_TEXT_LENGTH,
  rpcCommandSchema,
  rpcRequestSchema,
  selectSessionPayloadSchema,
  type HostEvent,
  type RpcCommandResponse,
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

describe("host commands (vscode-extension.md G8)", () => {
  it("allow-lists exactly the three HostCapabilities commands", () => {
    expect(hostCommandSchema.options).toEqual(["openSetting", "copyToClipboard", "openTextDocument"]);
    expect(Object.keys(hostCommandArgsSchemas).sort()).toEqual([...hostCommandSchema.options].sort());
  });

  it("accepts a command message and rejects malformed ones", () => {
    expect(
      rpcCommandSchema.safeParse({ kind: "command", id: "c1", command: "openSetting", args: { settingId: "a.b" } }).success,
    ).toBe(true);
    for (const bad of [
      { kind: "command", command: "openSetting" },
      { kind: "command", id: 1, command: "openSetting" },
      { kind: "command", id: "c1", command: "runShell" },
      { kind: "request", id: "c1", command: "openSetting" },
    ]) {
      expect(rpcCommandSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("openSetting takes one non-empty setting id", () => {
    const schema = hostCommandArgsSchemas.openSetting;

    expect(schema.safeParse({ settingId: "github.copilot.chat.agentDebugLog.fileLogging.enabled" }).success).toBe(true);
    for (const bad of [{}, { settingId: "" }, { settingId: 7 }, { settingId: ["a"] }]) {
      expect(schema.safeParse(bad).success).toBe(false);
    }
  });

  it("bounds clipboard text and document content at 5 MB of text", () => {
    const atLimit = "x".repeat(MAX_HOST_COMMAND_TEXT_LENGTH);
    const overLimit = `${atLimit}x`;

    expect(MAX_HOST_COMMAND_TEXT_LENGTH).toBe(5 * 1024 * 1024);
    expect(hostCommandArgsSchemas.copyToClipboard.safeParse({ text: atLimit }).success).toBe(true);
    expect(hostCommandArgsSchemas.copyToClipboard.safeParse({ text: overLimit }).success).toBe(false);
    expect(hostCommandArgsSchemas.openTextDocument.safeParse({ content: atLimit, language: "plaintext" }).success).toBe(true);
    expect(hostCommandArgsSchemas.openTextDocument.safeParse({ content: overLimit, language: "plaintext" }).success).toBe(false);
  });

  it("opens documents only in an allow-listed language", () => {
    const schema = hostCommandArgsSchemas.openTextDocument;

    for (const language of ["plaintext", "markdown", "json"]) {
      expect(schema.safeParse({ content: "x", language }).success).toBe(true);
    }
    for (const bad of [{ content: "x" }, { content: "x", language: "html" }, { content: 1, language: "plaintext" }]) {
      expect(schema.safeParse(bad).success).toBe(false);
    }
  });

  it("types a command response: ok, or a status and message", () => {
    const ok: RpcCommandResponse = { kind: "response", id: "c1", ok: true };
    const failed: RpcCommandResponse = { kind: "response", id: "c1", ok: false, error: { status: 400, message: "no" } };

    expect([ok.ok, failed.ok]).toEqual([true, false]);
  });

  it("is exported from the domain index", () => {
    expect(domain.hostCommandSchema).toBeDefined();
    expect(domain.hostCommandSchema).toBe(hostCommandSchema);
    expect(domain.hostCommandArgsSchemas).toBe(hostCommandArgsSchemas);
    expect(domain.rpcCommandSchema).toBe(rpcCommandSchema);
    expect(domain.MAX_HOST_COMMAND_TEXT_LENGTH).toBe(MAX_HOST_COMMAND_TEXT_LENGTH);
  });
});

describe("selectSessionPayloadSchema", () => {
  it("accepts a session id alone, or with a right tab, a center view and the advice dialog", () => {
    expect(selectSessionPayloadSchema.safeParse({ sessionId: "s1" }).success).toBe(true);
    expect(
      selectSessionPayloadSchema.safeParse({ sessionId: "s1", tab: "tools", view: "session-audit", adviceDialog: true }).success,
    ).toBe(true);
  });

  it("rejects an empty id, an unknown tab or view, and a non-object", () => {
    for (const bad of [
      { sessionId: "" },
      {},
      { sessionId: "s1", tab: "settings" },
      { sessionId: "s1", view: "dashboard" },
      { sessionId: "s1", adviceDialog: "yes" },
      "s1",
      null,
    ]) {
      expect(selectSessionPayloadSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("is exported from the domain index", () => {
    expect(domain.selectSessionPayloadSchema).toBe(selectSessionPayloadSchema);
  });
});
