import { describe, expect, it } from "vitest";
import * as domain from "./index.js";
import { productProfileSchema } from "./product-profile.js";

describe("productProfileSchema", () => {
  const standalone = {
    productId: "standalone",
    displayName: "Agent Cost Analyzer",
    version: "0.8.0",
    features: {
      providerSelect: true,
      crossProviderInsights: true,
      settingFixes: false,
      openInEditor: false,
      sessionSidebar: false,
    },
  };

  it("accepts the standalone app's profile", () => {
    expect(productProfileSchema.parse(standalone)).toEqual(standalone);
  });

  it("accepts the VS Code extension's profile", () => {
    const extension = {
      productId: "vscode-extension",
      displayName: "AI Credits Analyzer",
      version: "1.0.0",
      features: {
        providerSelect: false,
        crossProviderInsights: false,
        settingFixes: true,
        openInEditor: true,
        sessionSidebar: true,
      },
    };

    expect(productProfileSchema.parse(extension)).toEqual(extension);
  });

  it("rejects an unknown productId", () => {
    expect(() => productProfileSchema.parse({ ...standalone, productId: "web" })).toThrow();
  });

  it("rejects a profile missing a feature flag", () => {
    const features: Partial<typeof standalone.features> = { ...standalone.features };
    delete features.openInEditor;

    expect(() => productProfileSchema.parse({ ...standalone, features })).toThrow();
  });

  it("rejects a profile without sessionSidebar (step 10.11)", () => {
    const features: Partial<typeof standalone.features> = { ...standalone.features };
    delete features.sessionSidebar;

    expect(() => productProfileSchema.parse({ ...standalone, features })).toThrow();
  });

  it("is exported from the domain index", () => {
    expect(domain.productProfileSchema).toBe(productProfileSchema);
  });
});
