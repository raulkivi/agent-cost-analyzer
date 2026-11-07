import { afterEach, describe, expect, it, vi } from "vitest";
import { compareSessionReplay, fetchSessionReplay } from "./replay.js";

const total = { value: 0.042, knownTurns: 1, turns: 1 };
const replay = {
  simulated: true,
  sessionId: "s1",
  providerId: "claude-code",
  harness: "claude-code",
  measuredModels: ["claude-sonnet-5.5"],
  model: "gpt-6.1-sol",
  vendorId: "openai",
  pricing: { channel: "api", asOf: "2026-10-07", requested: "session-channel" },
  currency: "USD",
  turns: [],
  totals: { measured: total, simulated: { ...total, value: 0.031 }, difference: -0.011 },
  coverage: { turns: 1, replayedTurns: 1, requests: 1, replayedRequests: 1, notReplayed: [] },
  selfCheck: null,
  assumptions: [],
};
const comparison = {
  simulated: true,
  sessionId: "s1",
  providerId: "claude-code",
  currency: "USD",
  measured: total,
  entries: [{ model: "a", vendorId: "anthropic", total, replayedTurns: 1, isMeasuredModel: true }],
};

function stubFetch(body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) }));
}

// Phase 14 step 14.5: a session replayed on other models (plan §9).
describe("session replay api-client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks for one model's replay with only the options that are set", async () => {
    stubFetch(replay);
    await expect(fetchSessionReplay("s1", { model: "gpt-6.1-sol" })).resolves.toEqual(replay);
    expect(fetch).toHaveBeenCalledWith("/api/sessions/s1/replay?model=gpt-6.1-sol");
  });

  it("asks for a comparison with the models comma-joined and hands on the AbortSignal", async () => {
    stubFetch(comparison);
    const controller = new AbortController();
    await expect(compareSessionReplay("s1", { models: ["a", "b"], pricing: "api", provider: "claude-code" }, controller.signal)).resolves.toEqual(comparison);
    expect(fetch).toHaveBeenCalledWith("/api/sessions/s1/replay/compare?models=a%2Cb&pricing=api&provider=claude-code", { signal: controller.signal });
  });

  it("rejects an answer that isn't a SessionReplay, rather than rendering wrong figures", async () => {
    stubFetch({ sessionId: "s1" });
    await expect(fetchSessionReplay("s1", { model: "m" })).rejects.toThrow();
  });

  it("rejects an answer that isn't a SessionReplayComparison", async () => {
    stubFetch({ entries: "nope" });
    await expect(compareSessionReplay("s1", { models: ["m"] })).rejects.toThrow();
  });
});
