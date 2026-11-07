// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionReplayComparison } from "@agent-cost-analyzer/domain";
import { abortError } from "../api-client/abort.js";
import { compareSessionReplay } from "../api-client/replay.js";
import { useReplayComparison } from "./use-replay-comparison.js";

vi.mock("../api-client/replay.js", () => ({ compareSessionReplay: vi.fn() }));

const compare = vi.mocked(compareSessionReplay);

const COMPARISON: SessionReplayComparison = {
  simulated: true,
  sessionId: "s1",
  providerId: "claude-code",
  currency: "USD",
  measured: { value: 4.82, knownTurns: 11, turns: 12 },
  entries: [{ model: "claude-opus-5.5", vendorId: "anthropic", total: { value: 4.79, knownTurns: 11, turns: 12 }, replayedTurns: 11, isMeasuredModel: true }],
};

// Calls the test settles by hand; each rejects with an AbortError when its
// signal aborts, as the transports do.
let calls: Array<{ signal: AbortSignal | undefined; resolve(value: SessionReplayComparison): void; reject(error: unknown): void }>;

beforeEach(() => {
  calls = [];
  compare.mockReset();
  compare.mockImplementation(
    (_sessionId, _query, signal) =>
      new Promise((resolve, reject) => {
        calls.push({ signal, resolve, reject });
        signal?.addEventListener("abort", () => reject(abortError()));
      }),
  );
});

describe("useReplayComparison", () => {
  it("asks for the comparison and becomes ready with it", async () => {
    const { result } = renderHook(() => useReplayComparison("s1", "claude-code", ["gpt-6.1-sol"], "session-channel"));
    expect(result.current.status).toBe("loading");
    expect(compare).toHaveBeenCalledWith("s1", { models: ["gpt-6.1-sol"], pricing: "session-channel", provider: "claude-code" }, expect.any(AbortSignal));

    await act(async () => calls[0]!.resolve(COMPARISON));

    expect(result.current).toMatchObject({ status: "ready", data: COMPARISON, error: null });
  });

  it("leaves the provider out when none is given", () => {
    renderHook(() => useReplayComparison("s1", undefined, ["gpt-6.1-sol"], "api"));
    expect(compare).toHaveBeenCalledWith("s1", { models: ["gpt-6.1-sol"], pricing: "api" }, expect.any(AbortSignal));
  });

  it("reports a failure with its message, as given", async () => {
    const { result } = renderHook(() => useReplayComparison("s1", undefined, ["x"], "api"));
    await act(async () => calls[0]!.reject(new Error("Request to /api/x failed with status 400")));
    expect(result.current).toMatchObject({ status: "error", data: null, error: "Request to /api/x failed with status 400" });
  });

  it("cancel aborts the request and shows cancelled, not an error; retry asks again", async () => {
    const { result } = renderHook(() => useReplayComparison("s1", undefined, ["x"], "api"));
    await act(async () => result.current.cancel());
    expect(calls[0]!.signal?.aborted).toBe(true);
    expect(result.current.status).toBe("cancelled");

    await act(async () => result.current.retry());
    expect(compare).toHaveBeenCalledTimes(2);
    await act(async () => calls[1]!.resolve(COMPARISON));
    expect(result.current.status).toBe("ready");
  });

  it("refetches when the models change, aborting the earlier request", async () => {
    const { result, rerender } = renderHook(({ models }) => useReplayComparison("s1", undefined, models, "api"), {
      initialProps: { models: ["a"] },
    });
    rerender({ models: ["a", "b"] });
    expect(calls[0]!.signal?.aborted).toBe(true);
    expect(compare).toHaveBeenLastCalledWith("s1", { models: ["a", "b"], pricing: "api" }, expect.any(AbortSignal));

    await act(async () => calls[1]!.resolve(COMPARISON));
    expect(result.current.status).toBe("ready");
  });

  it("does not refetch for a new array with the same models", () => {
    const { rerender } = renderHook(({ models }) => useReplayComparison("s1", undefined, models, "api"), {
      initialProps: { models: ["a", "b"] },
    });
    rerender({ models: ["a", "b"] });
    expect(compare).toHaveBeenCalledTimes(1);
  });

  it("refetches when the pricing changes", () => {
    const { rerender } = renderHook(({ pricing }) => useReplayComparison("s1", undefined, ["a"], pricing), {
      initialProps: { pricing: "session-channel" as "session-channel" | "copilot" | "api" },
    });
    rerender({ pricing: "copilot" });
    expect(compare).toHaveBeenCalledTimes(2);
    expect(compare).toHaveBeenLastCalledWith("s1", { models: ["a"], pricing: "copilot" }, expect.any(AbortSignal));
  });

  it("asks for nothing with no models", () => {
    const { result } = renderHook(() => useReplayComparison("s1", undefined, [], "api"));
    expect(compare).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });
});
