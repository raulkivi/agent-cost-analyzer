import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { abortError } from "../api-client/abort.js";
import { useCancellableLoad } from "./use-cancellable-load.js";

// A load the test settles by hand; it rejects with an AbortError when its
// signal aborts, like a real transport.
function manualLoad<T>() {
  const calls: Array<{ signal: AbortSignal; resolve: (value: T) => void; reject: (error: unknown) => void }> = [];
  const load = vi.fn(
    (signal: AbortSignal) =>
      new Promise<T>((resolve, reject) => {
        calls.push({ signal, resolve, reject });
        signal.addEventListener("abort", () => reject(abortError()));
      }),
  );
  return { load, calls };
}

describe("useCancellableLoad", () => {
  it("loads on mount and becomes ready with the data", async () => {
    const { load, calls } = manualLoad<string>();
    const { result } = renderHook(() => useCancellableLoad(load));
    expect(result.current.state).toEqual({ kind: "loading" });

    await act(async () => calls[0].resolve("data"));

    expect(result.current.state).toEqual({ kind: "ready", data: "data" });
  });

  it("reports a failure with its message", async () => {
    const { load, calls } = manualLoad<string>();
    const { result } = renderHook(() => useCancellableLoad(load));

    await act(async () => calls[0].reject(new Error("boom")));

    expect(result.current.state).toEqual({ kind: "error", message: "boom" });
  });

  it("cancel aborts the signal and shows the cancelled state, not an error", async () => {
    const { load, calls } = manualLoad<string>();
    const { result } = renderHook(() => useCancellableLoad(load));

    await act(async () => result.current.cancel());

    expect(calls[0].signal.aborted).toBe(true);
    expect(result.current.state).toEqual({ kind: "cancelled" });
  });

  it("ignores an answer that arrives after a cancel", async () => {
    const { load, calls } = manualLoad<string>();
    const { result } = renderHook(() => useCancellableLoad(load));
    await act(async () => result.current.cancel());

    await act(async () => calls[0].resolve("late"));

    expect(result.current.state).toEqual({ kind: "cancelled" });
  });

  it("retry loads again with a fresh signal", async () => {
    const { load, calls } = manualLoad<string>();
    const { result } = renderHook(() => useCancellableLoad(load));
    await act(async () => result.current.cancel());

    act(() => result.current.retry());
    expect(result.current.state).toEqual({ kind: "loading" });
    expect(calls).toHaveLength(2);
    expect(calls[1].signal.aborted).toBe(false);
    await act(async () => calls[1].resolve("again"));

    expect(result.current.state).toEqual({ kind: "ready", data: "again" });
  });

  it("reloads, aborting the stale request, when the load function changes", async () => {
    const first = manualLoad<string>();
    const second = manualLoad<string>();
    const { result, rerender } = renderHook(({ load }) => useCancellableLoad(load), { initialProps: { load: first.load } });

    rerender({ load: second.load });

    expect(first.calls[0].signal.aborted).toBe(true);
    await act(async () => second.calls[0].resolve("fresh"));
    await waitFor(() => expect(result.current.state).toEqual({ kind: "ready", data: "fresh" }));
  });

  it("aborts the request when the component unmounts", () => {
    const { load, calls } = manualLoad<string>();
    const { unmount } = renderHook(() => useCancellableLoad(load));

    unmount();

    expect(calls[0].signal.aborted).toBe(true);
  });

  it("does not load while disabled", () => {
    const { load } = manualLoad<string>();

    renderHook(() => useCancellableLoad(load, false));

    expect(load).not.toHaveBeenCalled();
  });
});
