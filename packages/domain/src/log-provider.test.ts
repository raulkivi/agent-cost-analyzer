import { describe, expect, it } from "vitest";
import { logProviderDescriptorSchema, logProviderStatusSchema } from "./log-provider.js";

describe("logProviderDescriptorSchema", () => {
  it("accepts an available provider with no unavailableReason", () => {
    const sample = { id: "vscode", label: "VS Code (local Copilot Chat)", available: true };

    expect(logProviderDescriptorSchema.parse(sample)).toEqual(sample);
  });

  it("accepts an unavailable provider with a reason", () => {
    const sample = {
      id: "mitmproxy",
      label: "mitmproxy (HAR capture)",
      available: false,
      unavailableReason: "No .har files found in the configured captures directory.",
    };

    expect(logProviderDescriptorSchema.parse(sample)).toEqual(sample);
  });

  it("rejects a missing id", () => {
    const sample = { label: "VS Code", available: true };

    expect(() => logProviderDescriptorSchema.parse(sample)).toThrow();
  });
});

describe("logProviderStatusSchema", () => {
  it("accepts a status with multiple provider descriptors and an active id", () => {
    const sample = {
      providers: [
        { id: "vscode", label: "VS Code (local Copilot Chat)", available: true },
        { id: "mitmproxy", label: "mitmproxy (HAR capture)", available: false, unavailableReason: "no captures configured" },
      ],
      activeProviderId: "vscode",
    };

    expect(logProviderStatusSchema.parse(sample)).toEqual(sample);
  });

  it("rejects a missing activeProviderId", () => {
    const sample = { providers: [] };

    expect(() => logProviderStatusSchema.parse(sample)).toThrow();
  });
});
