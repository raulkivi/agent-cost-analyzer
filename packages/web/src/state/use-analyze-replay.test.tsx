// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeReplay } from "../test-support/replay-fixture.js";
import { useAnalyzeReplay, type AnalyzeReplaySession } from "./use-analyze-replay.js";

const claude: AnalyzeReplaySession = { id: "s1", providerId: "claude-code" };

function setup(session: AnalyzeReplaySession | null, enabled = true) {
  const load = vi.fn().mockResolvedValue(makeReplay());
  const hook = renderHook((props: { session: AnalyzeReplaySession | null; enabled: boolean }) => useAnalyzeReplay({ ...props, load }), {
    initialProps: { session, enabled },
  });
  return { ...hook, load };
}

describe("useAnalyzeReplay (step 14.7)", () => {
  it("replays the chosen model, and turns off again", async () => {
    const { result, load } = setup(claude);
    expect(result.current.model).toBeNull();
    act(() => result.current.setModel("claude-sonnet-5.5"));
    await waitFor(() => expect(result.current.replay).toBeDefined());
    expect(load).toHaveBeenCalledWith("s1", { model: "claude-sonnet-5.5", provider: "claude-code" }, expect.any(AbortSignal));
    act(() => result.current.setModel(null));
    expect(result.current.replay).toBeUndefined();
    expect(result.current.load.status).toBe("idle");
  });

  it("shares one pricing between the strip, the panel and Compare models", async () => {
    const { result, load } = setup(claude);
    act(() => result.current.setModel("claude-sonnet-5.5"));
    act(() => result.current.setPricing("copilot"));
    expect(result.current.pricing).toBe("copilot");
    await waitFor(() => expect(load).toHaveBeenLastCalledWith("s1", { model: "claude-sonnet-5.5", pricing: "copilot", provider: "claude-code" }, expect.any(AbortSignal)));
  });

  it("starts over for another session: Off, its own channel, the table, the summary closed", () => {
    const { result, rerender } = setup(claude);
    act(() => {
      result.current.setModel("claude-sonnet-5.5");
      result.current.setPricing("api");
      result.current.setCompareOpen(true);
      result.current.setSummaryOpen(true);
    });
    rerender({ session: { id: "s2", providerId: "claude-code" }, enabled: true });
    expect(result.current).toMatchObject({ model: null, pricing: "session-channel", compareOpen: false, summaryOpen: false });
  });

  it("asks for nothing when the product has no session replay, or the provider can't replay", () => {
    const off = setup(claude, false);
    act(() => off.result.current.setModel("claude-sonnet-5.5"));
    expect(off.load).not.toHaveBeenCalled();

    const pi = setup({ id: "p1", providerId: "pi" });
    expect(pi.result.current.unavailableReason).toBe("This provider's logs can't be replayed yet.");
    act(() => pi.result.current.setModel("claude-sonnet-5.5"));
    expect(pi.load).not.toHaveBeenCalled();
  });
});
