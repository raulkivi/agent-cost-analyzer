import { describe, expect, it } from "vitest";
import { RpcTrace } from "./rpc-trace.js";

const ok = (id: string) => ({ kind: "response", id, ok: true, result: { big: "payload" } });
const failed = (id: string, status: number) => ({ kind: "response", id, ok: false, error: { status, message: "no" } });

describe("RpcTrace", () => {
  it("records each answered request's method and outcome, oldest first, without the result", () => {
    const trace = new RpcTrace();

    trace.observe({ kind: "request", id: "1", method: "getHealth" }, ok("1"));
    trace.observe({ kind: "request", id: "2", method: "getSession", params: { id: "nope" } }, failed("2", 404));

    expect(trace.entries()).toEqual([
      { method: "getHealth", ok: true },
      { method: "getSession", ok: false, status: 404, sessionId: "nope" },
    ]);
  });

  it("keeps the session a request was about, from `id` or `sessionId`", () => {
    const trace = new RpcTrace();

    trace.observe({ kind: "request", id: "1", method: "getSession", params: { id: "s1" } }, ok("1"));
    trace.observe({ kind: "request", id: "2", method: "getSessionAudit", params: { sessionId: "s2" } }, ok("2"));
    trace.observe({ kind: "request", id: "3", method: "getSession", params: { id: 7 } }, failed("3", 400));

    expect(trace.entries().map((entry) => entry.sessionId)).toEqual(["s1", "s2", undefined]);
  });

  it("ignores everything that isn't a request with its own reply: commands, cancels, marks, dropped replies", () => {
    const trace = new RpcTrace();

    trace.observe({ kind: "command", id: "1", command: "copyToClipboard" }, { kind: "response", id: "1", ok: true });
    trace.observe({ kind: "cancel", id: "2" }, undefined);
    trace.observe({ kind: "perfMark", name: "first-render", timeMs: 1 }, undefined);
    trace.observe({ kind: "request", id: "3", method: "getInsights" }, undefined);
    trace.observe({ kind: "request", id: "4", method: "getHealth" }, ok("other"));
    trace.observe("junk", ok("5"));

    expect(trace.entries()).toEqual([]);
  });

  it("keeps only the most recent entries, and clear() empties it", () => {
    const trace = new RpcTrace(2);
    for (const id of ["1", "2", "3"]) trace.observe({ kind: "request", id, method: "getHealth", params: { id } }, ok(id));

    expect(trace.entries().map((entry) => entry.sessionId)).toEqual(["2", "3"]);

    trace.clear();
    expect(trace.entries()).toEqual([]);
  });
});
