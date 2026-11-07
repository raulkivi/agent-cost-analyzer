// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { resolveChannel } from "./channel-resolver.js";
import type { VendorResolution } from "./vendor-resolver.js";

const anthropic: VendorResolution = { known: true, vendorId: "anthropic", basis: "profile" };
const openai: VendorResolution = { known: true, vendorId: "openai", basis: "profile" };
const microsoft: VendorResolution = { known: true, vendorId: "microsoft", basis: "profile" };
const unknownVendor: VendorResolution = { known: false, reason: "No vendor profile lists the model." };

describe("resolveChannel (plan §6.3)", () => {
  it("sells VS Code turns through GitHub Copilot, whatever the model's vendor", () => {
    expect(resolveChannel({ providerId: "vscode", vendor: anthropic })).toEqual({ known: true, channel: "github-copilot" });
    expect(resolveChannel({ providerId: "vscode", vendor: unknownVendor })).toEqual({ known: true, channel: "github-copilot" });
  });

  it("puts Claude Code on the Anthropic API", () => {
    expect(resolveChannel({ providerId: "claude-code", vendor: anthropic })).toEqual({ known: true, channel: "anthropic-api" });
  });

  it("puts pi and mitmproxy on the API of the model's vendor", () => {
    expect(resolveChannel({ providerId: "pi-agent", vendor: openai })).toEqual({ known: true, channel: "openai-api" });
    expect(resolveChannel({ providerId: "mitmproxy", vendor: anthropic })).toEqual({ known: true, channel: "anthropic-api" });
  });

  it("keeps the channel unknown, with a reason, when the vendor or its API channel is unknown", () => {
    expect(resolveChannel({ providerId: "pi-agent", vendor: unknownVendor })).toEqual({
      known: false,
      reason: expect.stringContaining("No vendor profile lists the model."),
    });
    expect(resolveChannel({ providerId: "mitmproxy", vendor: microsoft })).toEqual({
      known: false,
      reason: expect.stringContaining("microsoft"),
    });
    expect(resolveChannel({ providerId: "future-agent", vendor: anthropic })).toEqual({
      known: false,
      reason: expect.stringContaining("future-agent"),
    });
  });

  it("honours the projects file's per-provider override", () => {
    const overrides = { "claude-code": "acme-bedrock", "future-agent": "openai-api" };
    expect(resolveChannel({ providerId: "claude-code", vendor: anthropic, overrides })).toEqual({ known: true, channel: "acme-bedrock" });
    expect(resolveChannel({ providerId: "future-agent", vendor: unknownVendor, overrides })).toEqual({ known: true, channel: "openai-api" });
  });

  it("ignores an override that is not a valid channel id, and one inherited from Object", () => {
    expect(resolveChannel({ providerId: "claude-code", vendor: anthropic, overrides: { "claude-code": "Not A Channel" } })).toEqual({
      known: true,
      channel: "anthropic-api",
    });
    expect(resolveChannel({ providerId: "toString", vendor: anthropic, overrides: {} })).toMatchObject({ known: false });
  });
});
