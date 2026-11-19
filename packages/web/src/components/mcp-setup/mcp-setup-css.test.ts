// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const themeCss = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../theme.css"), "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(themeCss);
  expect(match, `rule ${selector}`).not.toBeNull();
  return match?.[2] ?? "";
}

// jsdom does no layout, so the owner's no-wrap and no-sideways-scroll rules
// (§5.6.1) are pinned in the stylesheet; MC13's Playwright spec measures them.
describe("the Connect an agent CSS", () => {
  it("never wraps a code line and scrolls it sideways inside the block", () => {
    const body = rule(".mcp-code-text");
    expect(body).toContain("white-space: pre");
    expect(body).toContain("overflow-x: auto");
    expect(body).toContain("min-width: 0");
  });

  it("lets the dialog shrink to a phone and never scroll sideways", () => {
    const body = rule(".mcp-dialog");
    expect(body).toContain("width: min(760px, 100%)");
    expect(body).toContain("overflow-x: hidden");
    expect(rule(".mcp-body")).toContain("minmax(0, 1fr)");
  });

  it("hides the button text below 768 px only", () => {
    expect(themeCss).toMatch(/@media \(max-width: 767px\)\s*\{\s*\.mcp-connect-text\s*\{\s*display: none;/);
  });

  it("uses the same 520 px breakpoint as the component's select", () => {
    expect(themeCss).toContain("@media (max-width: 520px)");
  });
});
