// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { isPricedProvider } from "./priced-provider.js";

describe("isPricedProvider", () => {
  it("is true for Claude Code, which has no AI Credits", () => {
    expect(isPricedProvider("claude-code")).toBe(true);
  });

  it("is false for Copilot, other providers and no provider", () => {
    expect(isPricedProvider("vscode")).toBe(false);
    expect(isPricedProvider("pi-agent")).toBe(false);
    expect(isPricedProvider(undefined)).toBe(false);
  });
});
