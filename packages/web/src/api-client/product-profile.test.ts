import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProductProfile } from "@copilot-cost-analyzer/domain";
import { resetApiTransport, setApiTransport } from "./current-transport.js";
import { fetchProductProfile } from "./product-profile.js";

const profile: ProductProfile = {
  productId: "standalone",
  displayName: "Agent Cost Analyzer",
  version: "0.8.0",
  features: { providerSelect: true, crossProviderInsights: true, settingFixes: false, openInEditor: false, sessionSidebar: false },
};

describe("product-profile api-client (vscode-extension.md §3.3)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiTransport();
  });

  it("fetches the product profile from the standalone server", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(profile) }));

    await expect(fetchProductProfile()).resolves.toEqual(profile);
    expect(fetch).toHaveBeenCalledWith("/api/product");
  });

  it("asks the installed transport for getProductProfile, so the extension host answers it", async () => {
    const call = vi.fn().mockResolvedValue(profile);
    setApiTransport({ call });

    await expect(fetchProductProfile()).resolves.toEqual(profile);
    expect(call).toHaveBeenCalledWith("getProductProfile");
  });

  it("rejects when the backend fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    await expect(fetchProductProfile()).rejects.toThrow(/404/);
  });
});
