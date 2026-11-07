// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseRules } from "./css-vars.js";
import { HOST_CSS, THEME_CSS } from "./host-sets.js";

// A14 (docs/plans/mcp-apps.md §7): every control the views draw shows a
// visible focus ring, in the host's ring colour where the host sends one
// (--color-ring-primary, MCP Apps spec), and no view stylesheet takes it away.

const here = path.dirname(fileURLToPath(import.meta.url));
const VIEW_SHEETS = ["../../src/theme/views.css", "../../src/views/cost-rollup/cost-rollup.css", "../../src/views/findings/findings.css"].map((file) => ({
  file,
  css: readFileSync(path.join(here, file), "utf8"),
}));
const HTML_APP = 'html[data-host="mcp-app"]';

const declarationsOf = (css: string, selector: string) =>
  new Map(parseRules(css).filter((rule) => rule.selectors.includes(selector)).flatMap((rule) => rule.declarations));

describe("focus styles", () => {
  it("theme.css draws a 2px ring on :focus-visible", () => {
    expect(declarationsOf(THEME_CSS, ":focus-visible").get("outline")).toMatch(/^2px solid /);
  });

  it("the host mapping colours that ring with the host's ring token", () => {
    expect(declarationsOf(HOST_CSS, `${HTML_APP} :focus-visible`).get("outline-color")).toBe("var(--color-ring-primary, var(--color-accent))");
  });

  it("the filter radios' ring (drawn on their label) uses the host's ring token too", () => {
    expect(declarationsOf(HOST_CSS, `${HTML_APP} .seg-opt:has(input:focus-visible)`).get("outline-color")).toBe("var(--color-ring-primary, var(--color-accent))");
  });

  it("dimmed severity tiles stay legible: no opacity, which the contrast tests can't see", () => {
    const findings = VIEW_SHEETS.find((sheet) => sheet.file.endsWith("findings.css"))!.css;
    for (const rule of parseRules(findings).filter((r) => r.selectors.some((s) => s.includes(".is-dim")))) {
      expect(rule.declarations.map(([property]) => property)).not.toContain("opacity");
    }
  });

  it.each(VIEW_SHEETS)("$file never removes or hides an outline", ({ css }) => {
    for (const rule of parseRules(css)) {
      for (const [property, value] of rule.declarations) {
        if (property.startsWith("outline")) expect(`${rule.selectors.join(", ")} { ${property}: ${value} }`).not.toMatch(/:\s*(none|0(px)?)\s*}$/);
      }
    }
  });
});
