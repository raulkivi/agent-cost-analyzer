// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { MCP_ICON_SVG, MCP_ICONS } from "./mcp-branding.js";

describe("MCP_ICON_SVG", () => {
  it("is the glyph MCP_ICONS embeds", () => {
    expect(MCP_ICON_SVG).toMatch(/^<svg /);
    expect(MCP_ICONS[0]!.src).toBe("data:image/svg+xml;base64," + Buffer.from(MCP_ICON_SVG).toString("base64"));
  });
});
