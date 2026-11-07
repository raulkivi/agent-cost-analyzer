// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionReplay } from "@agent-cost-analyzer/domain";
import { ApiRequestError } from "../api-client/api-request-error.js";
import type { SessionReplayQuery } from "../api-client/replay.js";
import { makeReplay } from "../test-support/replay-fixture.js";
import { REPLAY_LOADING_DELAY_MS, useSessionReplay, type ReplayLoader } from "./use-session-replay.js";

type Args = { sessionId: string; providerId?: string; model: string | null; pricing: "session-channel" | "copilot" | "api" };

function setup(initial: Args, load: ReplayLoader) {
  return renderHook((args: Args) => useSessionReplay({ ...args, load }), { initialProps: initial });
}

// A loader whose answers the test settles by hand.
function deferredLoader() {
  const calls: { sessionId: string; query: SessionReplayQuery; signal: AbortSignal; resolve(value: SessionReplay): void; reject(error: unknown): void }[] = [];
  const load: ReplayLoader = (sessionId, query, signal) =>
    new Promise((resolve, reject) => {
      calls.push({ sessionId, query, signal, resolve, reject });
    });
  return { calls, load };
}

describe("useSessionReplay (step 14.7)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is idle, and asks for nothing, while no model is chosen", () => {
    const load = vi.fn();
    const { result } = setup({ sessionId: "s1", model: null, pricing: "session-channel" }, load);
    expect(result.current.status).toBe("idle");
    expect(load).not.toHaveBeenCalled();
  });

  it("loads the chosen model's replay, passing the provider and only a pricing that isn't the default", async () => {
    const { calls, load } = deferredLoader();
    const { result, rerender } = setup({ sessionId: "s1", providerId: "claude-code", model: "claude-sonnet-5.5", pricing: "session-channel" }, load);

    expect(result.current.status).toBe("loading");
    expect(calls[0]).toMatchObject({ sessionId: "s1", query: { model: "claude-sonnet-5.5", provider: "claude-code" } });
    expect(calls[0]!.query).not.toHaveProperty("pricing");
    const replay = makeReplay();
    await act(async () => calls[0]!.resolve(replay));
    expect(result.current).toMatchObject({ status: "ready", replay });

    rerender({ sessionId: "s1", providerId: "claude-code", model: "claude-sonnet-5.5", pricing: "copilot" });
    expect(calls[1]!.query).toMatchObject({ model: "claude-sonnet-5.5", pricing: "copilot" });
    // The previous answer is dropped while the new one loads.
    expect(result.current.status).toBe("loading");
    expect(result.current.replay).toBeUndefined();
  });

  it("only shows loading after 300 ms, so a quick answer doesn't flash a skeleton", async () => {
    vi.useFakeTimers();
    const { calls, load } = deferredLoader();
    const { result } = setup({ sessionId: "s1", model: "m", pricing: "session-channel" }, load);

    expect(result.current.showLoading).toBe(false);
    act(() => vi.advanceTimersByTime(REPLAY_LOADING_DELAY_MS - 1));
    expect(result.current.showLoading).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.showLoading).toBe(true);
    await act(async () => calls[0]!.resolve(makeReplay()));
    expect(result.current.showLoading).toBe(false);
  });

  it("aborts a superseded request and ignores whatever it answers later", async () => {
    const { calls, load } = deferredLoader();
    const { result, rerender } = setup({ sessionId: "s1", model: "a", pricing: "session-channel" }, load);
    rerender({ sessionId: "s1", model: "b", pricing: "session-channel" });

    expect(calls[0]!.signal.aborted).toBe(true);
    const newer = makeReplay({ model: "b" });
    await act(async () => calls[1]!.resolve(newer));
    await act(async () => calls[0]!.resolve(makeReplay({ model: "a" })));
    expect(result.current.replay?.model).toBe("b");
  });

  it("cancel() aborts the request and goes back to idle", async () => {
    const { calls, load } = deferredLoader();
    const { result } = setup({ sessionId: "s1", model: "a", pricing: "session-channel" }, load);

    act(() => result.current.cancel());
    expect(calls[0]!.signal.aborted).toBe(true);
    expect(result.current.status).toBe("idle");
  });

  it("keeps the API's own message and status on an error, and retries", async () => {
    const { calls, load } = deferredLoader();
    const { result } = setup({ sessionId: "s1", model: "a", pricing: "session-channel" }, load);

    await act(async () => calls[0]!.reject(new ApiRequestError("/api/sessions/s1/replay?model=a", 404, "This provider's logs can't be replayed yet.")));
    expect(result.current).toMatchObject({ status: "error", error: "This provider's logs can't be replayed yet.", errorStatus: 404 });

    act(() => result.current.retry());
    await waitFor(() => expect(calls).toHaveLength(2));
    await act(async () => calls[1]!.reject(new Error("network error: connection refused")));
    expect(result.current).toMatchObject({ status: "error", error: "network error: connection refused" });
    expect(result.current.errorStatus).toBeUndefined();
  });
});
