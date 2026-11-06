import { describe, expect, it, vi } from "vitest";
import { BadRequestError, NotFoundError } from "@agent-cost-analyzer/server/src/services/api/api-errors";
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
    getScenario: vi.fn(async () => ({ id: "cache-basics" }) as never),
    compareScenario: vi.fn(async () => ({ scenarioId: "cache-basics", entries: [] }) as never),
    listVendorProfiles: vi.fn(async () => []),
    getLogProviderStatus: vi.fn(async () => ({}) as never),
    setActiveLogProvider: vi.fn(async () => ({}) as never),
    getSessionAudit: vi.fn(async () => ({}) as never),
    listToolCalls: vi.fn(async () => ({ total: 0, calls: [] })),
    getAuditRollup: vi.fn(async () => ({}) as never),
    getInsights: vi.fn(async () => ({}) as never),
    getHealth: vi.fn(async () => ({ status: "ok" as const, version: "0.1.0" })),
    getProductProfile: vi.fn(async () => ({}) as never),
    getCostTimeSeries: vi.fn(async () => ({}) as never),
    getCostComparison: vi.fn(async () => ({}) as never),
    getProjectCost: vi.fn(async () => ({}) as never),
    getCostVariance: vi.fn(async () => ({}) as never),
    getStatement: vi.fn(async () => ({}) as never),
    issueStatement: vi.fn(async () => ({}) as never),
    getProjects: vi.fn(async () => ({}) as never),
    saveProjects: vi.fn(async () => ({}) as never),
    getRepositoryList: vi.fn(async () => ({}) as never),
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

  it("routes the vendor-simulation methods to ApiService (step 13.6)", async () => {
    const api = fakeApi();
    const dispatcher = new MessageDispatcher(api);

    await dispatcher.dispatch(request("getScenario", { id: "cache-basics", modelId: "claude-sonnet-5.5" }));
    await dispatcher.dispatch(request("getScenario", { id: "cache-basics" }));
    await dispatcher.dispatch(request("compareScenario", { id: "cache-basics", modelIds: ["a", "b"] }));
    await dispatcher.dispatch(request("listVendorProfiles"));

    expect(api.getScenario).toHaveBeenNthCalledWith(1, "cache-basics", "claude-sonnet-5.5");
    expect(api.getScenario).toHaveBeenNthCalledWith(2, "cache-basics", undefined);
    expect(api.compareScenario).toHaveBeenCalledWith("cache-basics", ["a", "b"]);
    expect(api.listVendorProfiles).toHaveBeenCalledOnce();
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

  // Step 15.9: the Dashboard's cost tabs call these; the extension's
  // ApiService has no cost analyses until step 15.14, so they answer 404.
  it("routes the cost methods to ApiService and answers its 404 while the extension has none", async () => {
    const api = fakeApi({
      getCostComparison: vi.fn(async () => {
        throw new NotFoundError("Cost analyses are not available in this product.");
      }),
    });
    const dispatcher = new MessageDispatcher(api);

    await dispatcher.dispatch(request("getCostTimeSeries", { since: "2026-10-01", bucket: "week", ids: ["a", "b"], groupBy: "project" }));
    const compare = await dispatcher.dispatch(request("getCostComparison", { since: "2026-10-01", until: "2026-10-31", groupBy: "project", ids: ["a", "b"] }));

    expect(api.getCostTimeSeries).toHaveBeenCalledWith({ since: "2026-10-01", bucket: "week", ids: "a,b", groupBy: "project" });
    expect(compare).toMatchObject({ ok: false, error: { status: 404 } });
  });

  // Step 15.11: statements (404 from the extension's ApiService until 15.14).
  it("routes the statement methods to ApiService", async () => {
    const api = fakeApi();
    const dispatcher = new MessageDispatcher(api);
    await dispatcher.dispatch(request("getStatement", { projectId: "portal", period: "2026-10" }));
    await dispatcher.dispatch(request("issueStatement", { projectId: "portal", period: "2026-10" }));
    expect(api.getStatement).toHaveBeenCalledWith({ projectId: "portal", period: "2026-10" });
    expect(api.issueStatement).toHaveBeenCalledWith("portal", "2026-10");
  });

  it("routes the projects methods to ApiService, the file as saveProjects' body", async () => {
    const api = fakeApi();
    const dispatcher = new MessageDispatcher(api);
    await dispatcher.dispatch(request("getProjects"));
    await dispatcher.dispatch(request("saveProjects", { file: { version: 1, projects: [] } }));
    await dispatcher.dispatch(request("getRepositoryList"));
    expect(api.getProjects).toHaveBeenCalled();
    expect(api.saveProjects).toHaveBeenCalledWith({ version: 1, projects: [] });
    expect(api.getRepositoryList).toHaveBeenCalled();
  });

  // Step 15.10: the Project tab's breakdown and variance.
  it("routes the project cost and variance methods to ApiService", async () => {
    const api = fakeApi();
    const dispatcher = new MessageDispatcher(api);
    await dispatcher.dispatch(request("getProjectCost", { projectId: "portal", since: "2026-10-01" }));
    await dispatcher.dispatch(request("getCostVariance", { groupBy: "project", id: "portal", periodA: "2026-08", periodB: "2026-10" }));
    expect(api.getProjectCost).toHaveBeenCalledWith({ projectId: "portal", since: "2026-10-01" });
    expect(api.getCostVariance).toHaveBeenCalledWith({ groupBy: "project", id: "portal", periodA: "2026-08", periodB: "2026-10" });
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
    ["getScenario", { id: 5 }, "id"],
    ["compareScenario", { id: "s", modelIds: [1] }, "modelIds"],
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

  describe("cancel", () => {
    // An ApiService method that answers only when the test says so.
    function slowApi() {
      let finish: (value: unknown) => void = () => undefined;
      let fail: (error: unknown) => void = () => undefined;
      const getInsights = vi.fn(
        () =>
          new Promise<never>((resolve, reject) => {
            finish = resolve as (value: unknown) => void;
            fail = reject;
          }),
      );
      return { api: fakeApi({ getInsights }), finish: (value: unknown) => finish(value), fail: (error: unknown) => fail(error) };
    }

    it("answers a cancel message with no reply", async () => {
      const dispatcher = new MessageDispatcher(fakeApi());

      expect(await dispatcher.dispatch({ kind: "cancel", id: "req-1" })).toBeUndefined();
    });

    it("posts no reply for a request cancelled before the service answered", async () => {
      const { api, finish } = slowApi();
      const dispatcher = new MessageDispatcher(api);
      const reply = dispatcher.dispatch(request("getInsights", {}));

      await dispatcher.dispatch({ kind: "cancel", id: "req-1" });
      finish({ sessions: [] });

      expect(await reply).toBeUndefined();
    });

    it("posts no error reply for a cancelled request that then fails", async () => {
      const { api, fail } = slowApi();
      const onInternalError = vi.fn();
      const dispatcher = new MessageDispatcher(api, { onInternalError });
      const reply = dispatcher.dispatch(request("getInsights", {}));

      await dispatcher.dispatch({ kind: "cancel", id: "req-1" });
      fail(new Error("boom"));

      expect(await reply).toBeUndefined();
    });

    it("leaves other requests in flight alone", async () => {
      const { api, finish } = slowApi();
      const dispatcher = new MessageDispatcher(api);
      const reply = dispatcher.dispatch({ kind: "request", id: "req-2", method: "getInsights", params: {} });

      await dispatcher.dispatch({ kind: "cancel", id: "req-1" });
      finish({ sessions: [] });

      expect(await reply).toEqual({ kind: "response", id: "req-2", ok: true, result: { sessions: [] } });
    });

    it("forgets a cancel for an id it isn't running, so a later request with that id is answered", async () => {
      const dispatcher = new MessageDispatcher(fakeApi());

      await dispatcher.dispatch({ kind: "cancel", id: "req-1" });
      const response = await dispatcher.dispatch(request("getHealth"));

      expect(response).toEqual({ kind: "response", id: "req-1", ok: true, result: { status: "ok", version: "0.1.0" } });
    });

    it("forgets a cancel once the request finished, so a reused id is answered", async () => {
      const { api, finish } = slowApi();
      const dispatcher = new MessageDispatcher(api);
      const first = dispatcher.dispatch(request("getInsights", {}));
      await dispatcher.dispatch({ kind: "cancel", id: "req-1" });
      finish({});
      await first;

      const second = dispatcher.dispatch(request("getInsights", {}));
      finish({ again: true });

      expect(await second).toEqual({ kind: "response", id: "req-1", ok: true, result: { again: true } });
    });

    it("ignores a cancel without a string id", async () => {
      const { api, finish } = slowApi();
      const dispatcher = new MessageDispatcher(api);
      const reply = dispatcher.dispatch(request("getInsights", {}));

      expect(await dispatcher.dispatch({ kind: "cancel" })).toBeUndefined();
      finish({});

      expect(await reply).toEqual({ kind: "response", id: "req-1", ok: true, result: {} });
    });
  });

  // Timing marks (domain rpc.ts, perfMark; step 10.9): one-way, recorded
  // and never answered.
  describe("request gate (step 10.16)", () => {
    it("answers a request only once the gate lets its method through", async () => {
      let open: () => void = () => undefined;
      const requestGate = { waitFor: vi.fn(() => new Promise<void>((resolve) => (open = resolve))) };
      const api = fakeApi();
      const reply = new MessageDispatcher(api, { requestGate }).dispatch(request("getInsights", {}));

      await Promise.resolve();
      expect(requestGate.waitFor).toHaveBeenCalledWith("getInsights");
      expect(api.getInsights).not.toHaveBeenCalled();

      open();
      expect(await reply).toMatchObject({ kind: "response", ok: true });
      expect(api.getInsights).toHaveBeenCalledTimes(1);
    });

    it("drops the reply of a request cancelled while the gate held it", async () => {
      let open: () => void = () => undefined;
      const requestGate = { waitFor: () => new Promise<void>((resolve) => (open = resolve)) };
      const dispatcher = new MessageDispatcher(fakeApi(), { requestGate });
      const reply = dispatcher.dispatch(request("getInsights", {}));

      await dispatcher.dispatch({ kind: "cancel", id: "req-1" });
      open();

      expect(await reply).toBeUndefined();
    });
  });

  describe("perfMark", () => {
    it("hands a valid mark to the recorder and posts no reply", async () => {
      const performanceMarks = { recordWebviewMark: vi.fn() };
      const api = fakeApi();

      const reply = await new MessageDispatcher(api, { performanceMarks }).dispatch({ kind: "perfMark", name: "first-render", timeMs: 210 });

      expect(reply).toBeUndefined();
      expect(performanceMarks.recordWebviewMark).toHaveBeenCalledWith("first-render", 210);
      expect(api.getHealth).not.toHaveBeenCalled();
    });

    it.each([
      ["an unknown name", { kind: "perfMark", name: "anything", timeMs: 1 }],
      ["a time that isn't a number", { kind: "perfMark", name: "data-ready", timeMs: "1" }],
      ["a negative time", { kind: "perfMark", name: "data-ready", timeMs: -5 }],
      ["no time", { kind: "perfMark", name: "data-ready" }],
    ])("drops a mark with %s, silently", async (_label, message) => {
      const performanceMarks = { recordWebviewMark: vi.fn() };

      expect(await new MessageDispatcher(fakeApi(), { performanceMarks }).dispatch(message)).toBeUndefined();
      expect(performanceMarks.recordWebviewMark).not.toHaveBeenCalled();
    });

    it("ignores marks when nothing records them", async () => {
      expect(await new MessageDispatcher(fakeApi()).dispatch({ kind: "perfMark", name: "first-render", timeMs: 1 })).toBeUndefined();
    });
  });
});
