// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { COPILOT_MCP_IDENTITY } from "../../composition/create-copilot-mcp-services.js";
import { STANDALONE_MCP_IDENTITY } from "../mcp-identity.js";
import { toViewBrand } from "./view-brand.js";

describe("toViewBrand", () => {
  it("maps the standalone identity, with no deep link", () => {
    const b = toViewBrand(STANDALONE_MCP_IDENTITY, "0.4.0");
    expect(b).toEqual({ productId: "standalone", displayName: "Agent Cost Analyzer", version: "0.4.0" });
    expect("deepLinkBase" in b).toBe(false);
  });

  it("maps the extension identity, with its deep link", () => {
    expect(toViewBrand(COPILOT_MCP_IDENTITY, "0.1.0")).toEqual({
      productId: "vscode-extension",
      displayName: "AI Credits Analyzer",
      version: "0.1.0",
      deepLinkBase: "vscode://raulkivi.ai-credits-analyzer",
    });
  });

  it("treats any identity that is not the extension's as standalone", () => {
    expect(toViewBrand({ ...STANDALONE_MCP_IDENTITY, name: "other" }, "1").productId).toBe("standalone");
  });
});
