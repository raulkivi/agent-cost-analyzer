import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchInsights } from "./insights.js";

function stubFetch(body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) }));
}

describe("insights api-client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the dataset with only the filters that are set", async () => {
    stubFetch({ sessions: [] });
    await expect(fetchInsights({ since: "2026-09-11", limit: 200 })).resolves.toEqual({ sessions: [] });
    expect(fetch).toHaveBeenCalledWith("/api/insights?since=2026-09-11&limit=200");
  });

  it("fetches an unfiltered dataset", async () => {
    stubFetch({});
    await fetchInsights({});
    expect(fetch).toHaveBeenCalledWith("/api/insights");
  });

  it("hands an AbortSignal to the request", async () => {
    stubFetch({});
    const controller = new AbortController();
    await fetchInsights({ since: "2026-09-11" }, controller.signal);
    expect(fetch).toHaveBeenCalledWith("/api/insights?since=2026-09-11", { signal: controller.signal });
  });
});
