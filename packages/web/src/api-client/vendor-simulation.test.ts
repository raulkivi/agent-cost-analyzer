import { afterEach, describe, expect, it, vi } from "vitest";
import { resetApiTransport, setApiTransport } from "./current-transport.js";
import type { ApiTransport } from "./transport.js";
import {
  compareScenario,
  fetchScenario,
  fetchVendorProfiles,
} from "./vendor-simulation.js";

const session = {
  id: "cache-basics",
  mode: "learn",
  title: "T",
  model: "claude-sonnet-5.5",
  turns: [],
  turnCount: 0,
  costAiCredits: { known: true, value: 0 },
  usageDataAvailable: true,
};
const comparison = {
  scenarioId: "cache-basics",
  entries: [
    {
      vendorId: "xai",
      modelId: "grok-4.7",
      displayName: "Grok 4.7",
      simulated: false,
      reason: "No cheaper model.",
      turns: [],
    },
  ],
};
const profile = {
  vendorId: "anthropic",
  displayName: "Anthropic",
  defaultModelId: "m",
  models: [{ modelId: "m", displayName: "M", simulated: true }],
  assumptions: [],
  sources: [],
  oldestCheckedAt: "2026-11-03",
};

function fakeTransport(result: unknown) {
  const call = vi.fn().mockResolvedValue(result);
  setApiTransport({ call } as unknown as ApiTransport);
  return call;
}

describe("vendor-simulation api-client", () => {
  afterEach(() => resetApiTransport());

  it("fetchScenario sends id and modelId and parses a Session", async () => {
    const call = fakeTransport(session);
    await expect(fetchScenario("cache-basics", "claude-sonnet-5.5")).resolves.toEqual(session);
    expect(call).toHaveBeenCalledWith("getScenario", { id: "cache-basics", modelId: "claude-sonnet-5.5" });
  });

  it("fetchScenario omits modelId when none is picked", async () => {
    const call = fakeTransport(session);
    await fetchScenario("cache-basics");
    expect(call).toHaveBeenCalledWith("getScenario", { id: "cache-basics", modelId: undefined });
  });

  it("compareScenario sends modelIds and parses a VendorComparison", async () => {
    const call = fakeTransport(comparison);
    await expect(compareScenario("cache-basics", ["grok-4.7"])).resolves.toEqual(comparison);
    expect(call).toHaveBeenCalledWith("compareScenario", { id: "cache-basics", modelIds: ["grok-4.7"] });
  });

  it("fetchVendorProfiles parses the summaries", async () => {
    fakeTransport([profile]);
    await expect(fetchVendorProfiles()).resolves.toEqual([profile]);
  });

  it("rejects a malformed response instead of passing it on", async () => {
    fakeTransport([{ vendorId: "x" }]);
    await expect(fetchVendorProfiles()).rejects.toThrow();
  });
});
