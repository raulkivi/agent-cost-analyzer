import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebviewTransport, type MessageSource } from "./webview-transport.js";
import { describeApiTransportContract, type ContractHarness } from "./transport-contract.js";

interface SentRequest {
  kind: "request";
  id: string;
  method: string;
  params: unknown;
}

// Fake of the window the webview runs in: dispatch() delivers a host message.
class FakeWindow implements MessageSource {
  private listeners = new Set<(event: { data: unknown }) => void>();
  addEventListener(_type: "message", listener: (event: { data: unknown }) => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "message", listener: (event: { data: unknown }) => void): void {
    this.listeners.delete(listener);
  }
  dispatch(data: unknown): void {
    for (const listener of [...this.listeners]) listener({ data });
  }
  get listenerCount(): number {
    return this.listeners.size;
  }
}

// Fake extension host: records requests; `autoReply` answers each at once.
function setup(timeoutMs?: number) {
  const win = new FakeWindow();
  const sent: SentRequest[] = [];
  let autoReply: ((request: SentRequest) => unknown) | undefined;
  const api = {
    postMessage: (message: unknown) => {
      const request = message as SentRequest;
      sent.push(request);
      const reply = autoReply?.(request);
      if (reply !== undefined) win.dispatch(reply);
    },
  };
  const transport = new WebviewTransport(api, win, timeoutMs === undefined ? undefined : { timeoutMs });
  return {
    win,
    sent,
    transport,
    setAutoReply: (fn: (request: SentRequest) => unknown) => {
      autoReply = fn;
    },
  };
}

function harness(): ContractHarness {
  const { transport, setAutoReply } = setup();
  return {
    transport,
    hang: () => setAutoReply(() => undefined),
    succeedWith: (value) =>
      setAutoReply((req) => ({ kind: "response", id: req.id, ok: true, result: value })),
    failWith: (status) =>
      setAutoReply((req) => ({ kind: "response", id: req.id, ok: false, error: { status, message: "nope" } })),
  };
}

describeApiTransportContract("WebviewTransport", harness);

// acquireVsCodeApi() can be called once per webview, and the transport is
// what calls it, so it also hands on the webview's state persistence
// (getState/setState) for the UI's view-state storage (§3.5 Layout).
describe("WebviewTransport view state", () => {
  it("exposes the webview API's getState/setState as viewState", () => {
    let state: unknown = { columns: ["turn"] };
    const api = {
      postMessage: vi.fn(),
      getState: () => state,
      setState: (next: unknown) => {
        state = next;
      },
    };
    const transport = new WebviewTransport(api, new FakeWindow());

    expect(transport.viewState?.getState()).toEqual({ columns: ["turn"] });
    transport.viewState?.setState({ columns: ["model"] });
    expect(state).toEqual({ columns: ["model"] });
  });

  it("has no viewState when the host API has no state persistence", () => {
    const transport = new WebviewTransport({ postMessage: vi.fn() }, new FakeWindow());

    expect(transport.viewState).toBeUndefined();
  });
});

describe("WebviewTransport", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("posts a request envelope with method and params", () => {
    const { transport, sent } = setup();
    void transport.call("getSession", { id: "s1" }).catch(() => undefined);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: "request", method: "getSession", params: { id: "s1" } });
    expect(typeof sent[0].id).toBe("string");
  });

  it("uses a unique id per request", () => {
    const { transport, sent } = setup();
    void transport.call("listSessions").catch(() => undefined);
    void transport.call("listSessions").catch(() => undefined);
    void transport.call("getHealth").catch(() => undefined);
    expect(new Set(sent.map((request) => request.id)).size).toBe(3);
  });

  it("matches out-of-order replies to the right caller", async () => {
    const { transport, sent, win } = setup();
    const first = transport.call<string>("getSession", { id: "a" });
    const second = transport.call<string>("getSession", { id: "b" });
    win.dispatch({ kind: "response", id: sent[1].id, ok: true, result: "B" });
    win.dispatch({ kind: "response", id: sent[0].id, ok: true, result: "A" });
    await expect(first).resolves.toBe("A");
    await expect(second).resolves.toBe("B");
  });

  it("rejects with the HTTP-style message including method and status", async () => {
    const { transport, sent, win } = setup();
    const pending = transport.call("getSession", { id: "x" });
    win.dispatch({ kind: "response", id: sent[0].id, ok: false, error: { status: 404, message: "Unknown session" } });
    await expect(pending).rejects.toThrow("Request to getSession failed with status 404");
  });

  it("ignores unrelated, malformed and unknown-id messages", async () => {
    const { transport, sent, win } = setup();
    const pending = transport.call<string>("getHealth");
    win.dispatch(undefined);
    win.dispatch("hello");
    win.dispatch({ type: "other" });
    win.dispatch({ kind: "response", id: "unknown", ok: true, result: "wrong" });
    win.dispatch({ kind: "response", id: sent[0].id, ok: true, result: "right" });
    await expect(pending).resolves.toBe("right");
  });

  it("settles a request only once", async () => {
    const { transport, sent, win } = setup();
    const pending = transport.call<string>("getHealth");
    win.dispatch({ kind: "response", id: sent[0].id, ok: true, result: "first" });
    win.dispatch({ kind: "response", id: sent[0].id, ok: false, error: { status: 500, message: "late" } });
    await expect(pending).resolves.toBe("first");
  });

  it("rejects after the timeout and ignores a late reply", async () => {
    const { transport, sent, win } = setup(1000);
    const pending = transport.call("getInsights", {});
    const assertion = expect(pending).rejects.toThrow("Request to getInsights timed out after 1000 ms");
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(() =>
      win.dispatch({ kind: "response", id: sent[0].id, ok: true, result: "late" }),
    ).not.toThrow();
  });

  it("defaults to a 60 s timeout", async () => {
    const { transport } = setup();
    const pending = transport.call("getInsights", {});
    const assertion = expect(pending).rejects.toThrow(/timed out after 60000 ms/);
    await vi.advanceTimersByTimeAsync(59_999);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
  });

  it("does not time out a request that was answered", async () => {
    const { transport, sent, win } = setup(1000);
    const pending = transport.call<string>("getHealth");
    win.dispatch({ kind: "response", id: sent[0].id, ok: true, result: "ok" });
    await expect(pending).resolves.toBe("ok");
    await vi.advanceTimersByTimeAsync(5000);
  });

  describe("host events", () => {
    it("delivers events to subscribers of that name only", () => {
      const { transport, win } = setup();
      const config = vi.fn();
      const select = vi.fn();
      transport.onEvent("configChanged", config);
      transport.onEvent("selectSession", select);
      win.dispatch({ kind: "event", name: "selectSession", payload: { id: "s1" } });
      expect(select).toHaveBeenCalledWith({ id: "s1" });
      expect(config).not.toHaveBeenCalled();
    });

    it("stops delivering after unsubscribe", () => {
      const { transport, win } = setup();
      const handler = vi.fn();
      const unsubscribe = transport.onEvent("configChanged", handler);
      unsubscribe();
      win.dispatch({ kind: "event", name: "configChanged" });
      expect(handler).not.toHaveBeenCalled();
    });

    it("does not treat an event as a response", async () => {
      const { transport, sent, win } = setup(1000);
      const pending = transport.call("getHealth");
      const assertion = expect(pending).rejects.toThrow(/timed out/);
      win.dispatch({ kind: "event", name: "configChanged", id: sent[0].id, ok: true, result: "x" });
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
    });
  });

  describe("host commands (G8)", () => {
    it("posts a command envelope with its own unique id", () => {
      const { transport, sent } = setup();
      void transport.call("listSessions").catch(() => undefined);
      void transport.command("openSetting", { settingId: "a.b" }).catch(() => undefined);
      expect(sent[1]).toMatchObject({ kind: "command", command: "openSetting", args: { settingId: "a.b" } });
      expect(sent[1].id).not.toBe(sent[0].id);
    });

    it("resolves when the host reports ok", async () => {
      const { transport, sent, win } = setup();
      const pending = transport.command("copyToClipboard", { text: "x" });
      win.dispatch({ kind: "response", id: sent[0].id, ok: true });
      await expect(pending).resolves.toBeUndefined();
    });

    it("rejects with the command name and status when the host refuses", async () => {
      const { transport, sent, win } = setup();
      const pending = transport.command("openSetting", { settingId: "x" });
      win.dispatch({ kind: "response", id: sent[0].id, ok: false, error: { status: 400, message: "no" } });
      await expect(pending).rejects.toThrow("Request to openSetting failed with status 400");
    });

    it("times out like a request", async () => {
      const { transport } = setup(1000);
      const pending = transport.command("openTextDocument", { content: "x", language: "plaintext" });
      const assertion = expect(pending).rejects.toThrow("Request to openTextDocument timed out after 1000 ms");
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
    });
  });
});

// Cancellation (domain rpc.ts, kind "cancel"): the call rejects at once and
// the host is told to forget the request.
describe("WebviewTransport cancellation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("posts a cancel for the request's id when the signal aborts", async () => {
    const { transport, sent } = setup();
    const controller = new AbortController();
    const pending = transport.call("getInsights", {}, controller.signal).catch((error: unknown) => error);

    controller.abort();

    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual({ kind: "cancel", id: sent[0].id });
    expect(await pending).toMatchObject({ name: "AbortError" });
  });

  it("posts nothing at all for a signal that was already aborted", async () => {
    const { transport, sent } = setup();
    const controller = new AbortController();
    controller.abort();

    await expect(transport.call("getInsights", {}, controller.signal)).rejects.toMatchObject({ name: "AbortError" });

    expect(sent).toEqual([]);
  });

  it("ignores the host's late reply to a cancelled request", async () => {
    const { transport, sent, win } = setup();
    const controller = new AbortController();
    const pending = transport.call("getInsights", {}, controller.signal).catch((error: unknown) => error);
    controller.abort();
    await pending;

    expect(() => win.dispatch({ kind: "response", id: sent[0].id, ok: true, result: {} })).not.toThrow();
  });

  it("does not time out a cancelled request later", async () => {
    const { transport } = setup(1000);
    const controller = new AbortController();
    const pending = transport.call("getInsights", {}, controller.signal).catch((error: unknown) => error);
    controller.abort();
    await pending;

    expect(vi.getTimerCount()).toBe(0);
  });

  it("posts no cancel for a request that already finished", async () => {
    const { transport, sent, setAutoReply } = setup();
    setAutoReply((req) => ({ kind: "response", id: req.id, ok: true, result: 1 }));
    const controller = new AbortController();

    await transport.call("getInsights", {}, controller.signal);
    controller.abort();

    expect(sent).toHaveLength(1);
  });

  it("leaves other pending requests alone", async () => {
    const { transport, sent, win } = setup();
    const controller = new AbortController();
    const cancelled = transport.call("getInsights", {}, controller.signal).catch((error: unknown) => error);
    const other = transport.call("getHealth");

    controller.abort();
    await cancelled;
    win.dispatch({ kind: "response", id: sent[1].id, ok: true, result: "fine" });

    await expect(other).resolves.toBe("fine");
  });
});
