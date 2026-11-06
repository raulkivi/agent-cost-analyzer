import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VendorComparison } from "@agent-cost-analyzer/domain";

const compareScenario = vi.fn();
vi.mock("../api-client/vendor-simulation.js", () => ({
  compareScenario: (...args: unknown[]) => compareScenario(...args),
}));

import { useScenarioComparison } from "./use-scenario-comparison.js";

const comparison = (scenarioId: string): VendorComparison => ({ scenarioId, entries: [] });

describe("useScenarioComparison", () => {
  beforeEach(() => {
    compareScenario.mockReset();
  });

  it("does not fetch when disabled or without a session", () => {
    const { result, rerender } = renderHook((props) => useScenarioComparison(props.id, props.enabled), {
      initialProps: { id: "s", enabled: false },
    });
    expect(result.current.status).toBe("idle");
    rerender({ id: null as unknown as string, enabled: true });
    expect(compareScenario).not.toHaveBeenCalled();
  });

  it("loads the comparison for the session", async () => {
    compareScenario.mockResolvedValue(comparison("s"));
    const { result } = renderHook(() => useScenarioComparison("s", true));
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.comparison?.scenarioId).toBe("s");
    expect(compareScenario).toHaveBeenCalledWith("s", undefined);
  });

  it("passes model ids when given and refetches when they change", async () => {
    compareScenario.mockResolvedValue(comparison("s"));
    const { rerender } = renderHook((props) => useScenarioComparison("s", true, props.ids), {
      initialProps: { ids: ["a"] },
    });
    await waitFor(() => expect(compareScenario).toHaveBeenCalledWith("s", ["a"]));
    rerender({ ids: ["a", "b"] });
    await waitFor(() => expect(compareScenario).toHaveBeenCalledWith("s", ["a", "b"]));
  });

  it("ignores a stale answer after the session changed", async () => {
    let resolveFirst: (value: VendorComparison) => void = () => undefined;
    compareScenario
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce(comparison("second"));
    const { result, rerender } = renderHook((props) => useScenarioComparison(props.id, true), {
      initialProps: { id: "first" },
    });
    rerender({ id: "second" });
    await waitFor(() => expect(result.current.comparison?.scenarioId).toBe("second"));
    resolveFirst(comparison("first"));
    await Promise.resolve();
    expect(result.current.comparison?.scenarioId).toBe("second");
  });

  it("reports an error and clears the comparison", async () => {
    compareScenario.mockImplementation(() => Promise.reject(new Error("boom")));
    const { result } = renderHook(() => useScenarioComparison("s", true));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("boom");
    expect(result.current.comparison).toBeNull();
  });
});
