// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { firstModelRequest, inFlightCheck, loggedCredits, newEntries } from "./in-flight-model.mts";

function llmRequest(model: string, nanoAiu?: number, debugName = "panel/editAgent"): string {
  const attrs: Record<string, unknown> = { model, debugName, inputTokens: 100, outputTokens: 5 };
  if (nanoAiu !== undefined) attrs.copilotUsageNanoAiu = nanoAiu;
  return JSON.stringify({ type: "llm_request", name: `chat:${model}`, attrs });
}

const SESSION_START = JSON.stringify({ type: "session_start", name: "session_start", attrs: {} });

describe("firstModelRequest (Copilot's debug log, main.jsonl)", () => {
  it("is the first llm_request's model, with what it cost and what made it", () => {
    const log = [SESSION_START, llmRequest("claude-sonnet-5.5", 4_500_000_000), llmRequest("claude-haiku-5.5", 1)].join("\n");

    expect(firstModelRequest(log)).toEqual({ model: "claude-sonnet-5.5", aiCredits: 4.5, debugName: "panel/editAgent" });
  });

  it("is undefined until a request is logged", () => {
    expect(firstModelRequest(SESSION_START)).toBeUndefined();
    expect(firstModelRequest("")).toBeUndefined();
  });

  it("ignores a line still being written, and a request without a model", () => {
    const noModel = JSON.stringify({ type: "llm_request", attrs: { inputTokens: 1, outputTokens: 1 } });
    expect(firstModelRequest(`${noModel}\n{"type":"llm_req`)).toBeUndefined();
  });

  it("reads unknown credits as null, never 0", () => {
    expect(firstModelRequest(llmRequest("claude-haiku-5.5"))).toMatchObject({ aiCredits: null });
  });
});

describe("loggedCredits (what a cancelled chat cost so far)", () => {
  it("sums every logged request's AI Credits", () => {
    expect(loggedCredits([llmRequest("a", 1_000_000_000), llmRequest("b", 500_000_000), llmRequest("c")].join("\n"))).toBeCloseTo(1.5);
  });

  it("is 0 when nothing is logged", () => {
    expect(loggedCredits(SESSION_START)).toBe(0);
  });
});

describe("newEntries", () => {
  it("lists what wasn't there before the chat was sent", () => {
    expect(newEntries(new Set(["a", "b"]), ["a", "c", "b", "d"])).toEqual(["c", "d"]);
  });
});

describe("inFlightCheck (while the chat runs: a wrong model costs at most its first request)", () => {
  const requested = "claude-haiku-5.5";

  it("keeps waiting while nothing is logged", () => {
    expect(inFlightCheck({ requested, firstRequest: undefined, agentHostSessions: [] })).toEqual({ verdict: "waiting" });
  });

  it("lets the chat run when the first request is on the requested model, in any spelling", () => {
    expect(inFlightCheck({ requested, firstRequest: { model: "claude-haiku-5-5", aiCredits: 0.1 }, agentHostSessions: [] })).toEqual({ verdict: "ok" });
  });

  it("cancels on another model, naming it and its cost", () => {
    const check = inFlightCheck({ requested, firstRequest: { model: "claude-sonnet-5.5", aiCredits: 4.25 }, agentHostSessions: [] });

    expect(check.verdict).toBe("cancel");
    expect(check).toMatchObject({ reason: expect.stringContaining('"claude-sonnet-5.5"') });
    expect(check).toMatchObject({ reason: expect.stringContaining("claude-haiku-5.5") });
    expect(check).toMatchObject({ reason: expect.stringContaining("cancelled") });
  });

  it("cancels at once when the chat started in the Copilot SDK harness (agent host), whose model the suite doesn't pick", () => {
    const check = inFlightCheck({ requested, firstRequest: undefined, agentHostSessions: ["0a1b"] });

    expect(check).toEqual({ verdict: "cancel", reason: expect.stringContaining("Copilot SDK harness") });
  });
});
