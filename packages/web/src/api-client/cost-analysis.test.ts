import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCostComparison, fetchCostTimeSeries } from "./cost-analysis.js";

function stubFetch(body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) }));
}

// Phase 15 step 15.9: the Dashboard's cost tabs over GET /api/cost/*.
describe("cost analysis api-client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks for a time series with only the options that are set", async () => {
    stubFetch({ points: [] });
    await expect(fetchCostTimeSeries({ since: "2026-08-09", until: "2026-11-06", bucket: "week", groupBy: "project", ids: ["portal"] })).resolves.toEqual({ points: [] });
    expect(fetch).toHaveBeenCalledWith("/api/cost/timeseries?since=2026-08-09&until=2026-11-06&bucket=week&groupBy=project&ids=portal");
  });

  it("asks for a comparison and hands on the AbortSignal", async () => {
    stubFetch({ rows: [] });
    const controller = new AbortController();
    await fetchCostComparison({ since: "2026-08-09", until: "2026-11-06", groupBy: "repository", ids: ["a", "b"], provider: "vscode" }, controller.signal);
    expect(fetch).toHaveBeenCalledWith("/api/cost/compare?since=2026-08-09&until=2026-11-06&groupBy=repository&ids=a%2Cb&provider=vscode", { signal: controller.signal });
  });
});
