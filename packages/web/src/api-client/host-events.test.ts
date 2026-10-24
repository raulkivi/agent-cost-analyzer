import { afterEach, describe, expect, it, vi } from "vitest";
import { resetApiTransport, setApiTransport } from "./current-transport.js";
import { onHostEvent } from "./host-events.js";
import type { ApiTransport } from "./transport.js";

afterEach(() => {
  resetApiTransport();
});

describe("onHostEvent", () => {
  it("subscribes through the installed transport and returns its unsubscribe", () => {
    const unsubscribe = vi.fn();
    const onEvent = vi.fn(() => unsubscribe);
    setApiTransport({ call: vi.fn(), onEvent } as ApiTransport);
    const handler = vi.fn();

    const result = onHostEvent("configChanged", handler);

    expect(onEvent).toHaveBeenCalledWith("configChanged", handler);
    result();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("is a no-op on a transport without events (the standalone app's HTTP transport)", () => {
    const handler = vi.fn();

    const unsubscribe = onHostEvent("configChanged", handler);

    expect(typeof unsubscribe).toBe("function");
    expect(() => unsubscribe()).not.toThrow();
  });
});
