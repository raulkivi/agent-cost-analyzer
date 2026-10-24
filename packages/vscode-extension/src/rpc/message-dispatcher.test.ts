import { describe, expect, it, vi } from "vitest";
import { BadRequestError, NotFoundError } from "@copilot-cost-analyzer/server/src/services/api/api-errors";
import { MessageDispatcher, type DispatcherApi } from "./message-dispatcher.js";

function fakeApi(overrides: Partial<DispatcherApi> = {}): DispatcherApi {
  const api: DispatcherApi = {
    listSessions: vi.fn(async () => []),
    getSession: vi.fn(async () => ({}) as never),
    getTurnDetail: vi.fn(async () => ({}) as never),
    getSystemPromptText: vi.fn(async () => "prompt"),
    getConfigStatus: vi.fn(async () => ({}) as never),
    setRetentionThreshold: vi.fn(async () => ({}) as never),
    listLearnScenarios: vi.fn(async () => []),
    getLearnScenario: vi.fn(async () => ({ id: "cache-basics" }) as never),
    getLogProviderStatus: vi.fn(async () => ({}) as never),
    setActiveLogProvider: vi.fn(async () => ({}) as never),
    getSessionAudit: vi.fn(async () => ({}) as never),
    listToolCalls: vi.fn(async () => ({ total: 0, calls: [] })),
    getAuditRollup: vi.fn(async () => ({}) as never),
    getInsights: vi.fn(async () => ({}) as never),
    getHealth: vi.fn(async () => ({ status: "ok" as const, version: "0.1.0" })),
    getProductProfile: vi.fn(async () => ({}) as never),
  };
  return { ...api, ...overrides };
}

function request(method: unknown, params?: unknown) {
  return { kind: "request", id: "req-1", method, params };
}

describe("MessageDispatcher (vscode-extension.md §4)", () => {
  it("answers a known method with its result", async () => {
    const api = fakeApi();

    const response = await new MessageDispatcher(api).dispatch(request("getLearnScenario", { id: "cache-basics" }));

    expect(api.getLearnScenario).toHaveBeenCalledWith("cache-basics");
    expect(response).toEqual({ kind: "response", id: "req-1", ok: true, result: { id: "cache-basics" } });
  });

  it.each(["deleteEverything", "constructor", "__proto__", 42, undefined])(
    "rejects the method %s, which isn't on the allow-list, with 400",
    async (method) => {
      const api = fakeApi();

      const response = await new MessageDispatcher(api).dispatch(request(method));

      expect(response).toEqual({
        kind: "response",
        id: "req-1",
        ok: false,
        error: { status: 400, message: `Unknown method "${String(method)}"` },
      });
    },
  );

  it("maps a typed NotFound to 404 with its message", async () => {
    const api = fakeApi({
      getSession: vi.fn(async () => {
        throw new NotFoundError('Unknown session id "nope"');
      }),
    });

    const response = await new MessageDispatcher(api).dispatch(request("getSession", { id: "nope" }));

    expect(response).toEqual({
      kind: "response",
      id: "req-1",
      ok: false,
      error: { status: 404, message: 'Unknown session id "nope"' },
    });
  });

  it("maps a typed BadRequest to 400 with its message", async () => {
    const api = fakeApi({
      setRetentionThreshold: vi.fn(async () => {
        throw new BadRequestError('Request body must include a positive integer "value".');
      }),
    });

    const response = await new MessageDispatcher(api).dispatch(request("setRetentionThreshold", { value: -1 }));

    expect(response).toMatchObject({ ok: false, error: { status: 400 } });
  });

  it("answers any other thrown error with a generic 500: no message details, no stack", async () => {
    const failure = new Error("EACCES: /home/someone/.config/Code/secret");
    const onInternalError = vi.fn();
    const api = fakeApi({
      listSessions: vi.fn(async () => {
        throw failure;
      }),
    });

    const response = await new MessageDispatcher(api, { onInternalError }).dispatch(request("listSessions"));

    expect(response).toEqual({
      kind: "response",
      id: "req-1",
      ok: false,
      error: { status: 500, message: "Internal error" },
    });
    expect(JSON.stringify(response)).not.toContain("secret");
    expect(JSON.stringify(response)).not.toContain("at ");
    expect(onInternalError).toHaveBeenCalledWith("listSessions", failure);
  });

  it("maps the web transports' param keys onto the ApiService arguments", async () => {
    const api = fakeApi();
    const dispatcher = new MessageDispatcher(api);

    await dispatcher.dispatch(request("getTurnDetail", { sessionId: "s1", turnIndex: 3 }));
    await dispatcher.dispatch(request("getSystemPromptText", { id: "s1" }));
    await dispatcher.dispatch(request("setRetentionThreshold", { value: 200 }));
    await dispatcher.dispatch(request("setActiveLogProvider", { id: "vscode" }));
    await dispatcher.dispatch(request("getSessionAudit", { sessionId: "s1" }));
    await dispatcher.dispatch(request("listSessions"));

    expect(api.getTurnDetail).toHaveBeenCalledWith("s1", 3);
    expect(api.getSystemPromptText).toHaveBeenCalledWith("s1");
    expect(api.setRetentionThreshold).toHaveBeenCalledWith(200);
    expect(api.setActiveLogProvider).toHaveBeenCalledWith("vscode");
    expect(api.getSessionAudit).toHaveBeenCalledWith("s1", {});
    expect(api.listSessions).toHaveBeenCalledWith();
  });

  it("passes query fields the way the HTTP query string would: lists comma-joined, numbers as text, blanks dropped", async () => {
    const api = fakeApi();
    const dispatcher = new MessageDispatcher(api);

    await dispatcher.dispatch(
      request("listToolCalls", { sessionId: "s1", status: ["failed", "denied"], limit: 5, tool: undefined, kind: "" }),
    );
    await dispatcher.dispatch(request("getAuditRollup", { since: "2026-01-01", limit: 10 }));
    await dispatcher.dispatch(request("getInsights", {}));

    expect(api.listToolCalls).toHaveBeenCalledWith("s1", { status: "failed,denied", limit: "5" });
    expect(api.getAuditRollup).toHaveBeenCalledWith({ since: "2026-01-01", limit: "10" });
    expect(api.getInsights).toHaveBeenCalledWith({});
  });

  it.each([
    ["getSession", {}, "id"],
    ["getSession", { id: 7 }, "id"],
    ["getSystemPromptText", { id: "" }, "id"],
    ["getLearnScenario", { id: null }, "id"],
    ["getTurnDetail", { sessionId: 7, turnIndex: 0 }, "sessionId"],
    ["getSessionAudit", {}, "sessionId"],
    ["listToolCalls", { sessionId: "s1", status: [1] }, "status"],
    ["getAuditRollup", { limit: { n: 1 } }, "limit"],
    ["getInsights", { since: 5 }, "since"],
  ])("rejects %s params %j with a 400 that names the field %s, without calling the service", async (method, params, field) => {
    const api = fakeApi();

    const response = await new MessageDispatcher(api).dispatch(request(method, params));

    expect(response).toMatchObject({ ok: false, error: { status: 400 } });
    const message = (response as { error: { message: string } }).error.message;
    expect(message).toContain(`Invalid params for ${method}`);
    expect(message).toContain(field);
    for (const call of Object.values(api)) {
      expect(call).not.toHaveBeenCalled();
    }
  });

  it("leaves the turn index and retention value to ApiService, so its messages stay the source of the 400s", async () => {
    const api = fakeApi({
      getTurnDetail: vi.fn(async () => {
        throw new BadRequestError('"x" is not a valid turn index.');
      }),
    });
    const dispatcher = new MessageDispatcher(api);

    expect(await dispatcher.dispatch(request("getTurnDetail", { sessionId: "s1", turnIndex: "x" }))).toMatchObject({
      ok: false,
      error: { status: 400, message: '"x" is not a valid turn index.' },
    });
    await dispatcher.dispatch(request("setRetentionThreshold", { value: -1 }));
    expect(api.setRetentionThreshold).toHaveBeenCalledWith(-1);
  });

  it("does not pass unlisted fields on to the service", async () => {
    const api = fakeApi();

    await new MessageDispatcher(api).dispatch(request("getAuditRollup", { since: "2026-01-01", hacker: "x" }));

    expect(api.getAuditRollup).toHaveBeenCalledWith({ since: "2026-01-01" });
  });

  it.each([["text"], [[1, 2]], [null]])("rejects params that aren't an object (%j) with 400", async (params) => {
    const response = await new MessageDispatcher(fakeApi()).dispatch(request("listSessions", params));

    expect(response).toMatchObject({ ok: false, error: { status: 400, message: "params must be an object" } });
  });

  it.each([
    ["a host event echo", { kind: "event", name: "configChanged" }],
    ["a request without an id", { kind: "request", method: "getHealth" }],
    ["a non-object", "getHealth"],
    ["null", null],
  ])("ignores %s", async (_label, message) => {
    const api = fakeApi();

    expect(await new MessageDispatcher(api).dispatch(message)).toBeUndefined();
    expect(api.getHealth).not.toHaveBeenCalled();
  });

  describe("host commands (G8)", () => {
    it("hands a command message to the host-command handler and returns its reply", async () => {
      const reply = { kind: "response" as const, id: "cmd-1", ok: true as const };
      const hostCommands = { handle: vi.fn(async () => reply) };
      const message = { kind: "command", id: "cmd-1", command: "copyToClipboard", args: { text: "x" } };

      const response = await new MessageDispatcher(fakeApi(), { hostCommands }).dispatch(message);

      expect(hostCommands.handle).toHaveBeenCalledWith(message);
      expect(response).toBe(reply);
    });

    it("answers a command with 400 when the host has no host commands", async () => {
      const response = await new MessageDispatcher(fakeApi()).dispatch({ kind: "command", id: "cmd-1", command: "copyToClipboard" });

      expect(response).toEqual({
        kind: "response",
        id: "cmd-1",
        ok: false,
        error: { status: 400, message: "Host commands are not available" },
      });
    });

    it("ignores a command without a string id", async () => {
      const hostCommands = { handle: vi.fn() };

      expect(await new MessageDispatcher(fakeApi(), { hostCommands }).dispatch({ kind: "command", command: "copyToClipboard" })).toBeUndefined();
      expect(hostCommands.handle).not.toHaveBeenCalled();
    });

    it("never routes a command to ApiService, even one named like a method", async () => {
      const api = fakeApi();
      const hostCommands = { handle: vi.fn(async () => ({ kind: "response" as const, id: "c", ok: true as const })) };

      await new MessageDispatcher(api, { hostCommands }).dispatch({ kind: "command", id: "c", command: "listSessions" });

      expect(api.listSessions).not.toHaveBeenCalled();
    });
  });
});
