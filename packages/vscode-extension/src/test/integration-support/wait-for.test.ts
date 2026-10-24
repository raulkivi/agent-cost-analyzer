import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "./wait-for.js";

describe("waitFor (the integration suite's polling)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves with the first value the condition accepts", async () => {
    let calls = 0;
    const result = waitFor(
      async () => ++calls,
      (value) => value >= 3,
      { timeoutMs: 1000, intervalMs: 10, description: "three calls" },
    );

    await vi.advanceTimersByTimeAsync(50);

    await expect(result).resolves.toBe(3);
    expect(calls).toBe(3);
  });

  it("resolves at once when the first read is accepted", async () => {
    await expect(waitFor(() => "ready", (value) => value === "ready", { timeoutMs: 10, description: "ready" })).resolves.toBe("ready");
  });

  it("rejects after the timeout, naming what it waited for and the last value it saw", async () => {
    const result = waitFor(() => ({ marks: [] }), () => false, { timeoutMs: 100, intervalMs: 25, description: "the data-ready mark" });
    const assertion = expect(result).rejects.toThrow('Timed out after 100 ms waiting for the data-ready mark; last value: {"marks":[]}');

    await vi.advanceTimersByTimeAsync(150);

    await assertion;
  });

  it("keeps polling past a read that throws, and reports the last error on timeout", async () => {
    let calls = 0;
    const result = waitFor(
      () => {
        calls++;
        if (calls < 3) throw new Error("command not registered yet");
        return calls;
      },
      () => true,
      { timeoutMs: 1000, intervalMs: 10, description: "the command" },
    );
    await vi.advanceTimersByTimeAsync(30);
    await expect(result).resolves.toBe(3);

    const failing = waitFor(
      () => {
        throw new Error("still not there");
      },
      () => true,
      { timeoutMs: 50, intervalMs: 10, description: "the command" },
    );
    const assertion = expect(failing).rejects.toThrow("last error: still not there");
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });
});
