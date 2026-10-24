import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchHealth } from "./health.js";

describe("health api-client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the server health", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: "ok", version: "0.1.0" }) }),
    );
    await expect(fetchHealth()).resolves.toEqual({ status: "ok", version: "0.1.0" });
    expect(fetch).toHaveBeenCalledWith("/api/health");
  });

  it("throws when the server is unhealthy", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(fetchHealth()).rejects.toThrow(/503/);
  });
});
