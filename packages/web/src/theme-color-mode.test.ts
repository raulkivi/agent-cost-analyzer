// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The ledger theme (dense-ledger-ui.md L1, D1): its palette, dark mode and
// fonts live in theme.css under html[data-color-mode], which only the
// standalone app sets. The VS Code webview and the MCP Apps views import the
// same file and must keep the Industry :root, so no ledger rule may reach
// them (mirrors theme-vscode.test.ts's scoping check).

const srcDir = path.dirname(fileURLToPath(import.meta.url));
const MODES = ["light", "dark"] as const;
const scopeOf = (mode: (typeof MODES)[number]) => `html[data-color-mode="${mode}"]`;

interface Rule {
  selectors: string[];
  declarations: Map<string, string>;
}

// Flat rules only: an @media block's inner rules come out with the at-rule
// glued to their first selector, which the scoping check then rejects.
function parseRules(css: string): Rule[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => {
    const declarations = new Map<string, string>();
    for (const declaration of match[2]!.split(";")) {
      const colon = declaration.indexOf(":");
      if (colon > 0) declarations.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
    }
    return { selectors: match[1]!.split(",").map((selector) => selector.trim()), declarations };
  });
}

const css = readFileSync(path.join(srcDir, "theme.css"), "utf-8");
const rules = parseRules(css);
const root = rules.find((rule) => rule.selectors.includes(":root"))!.declarations;

function modeTokens(mode: (typeof MODES)[number]): Map<string, string> {
  return new Map(rules.filter((rule) => rule.selectors.includes(scopeOf(mode))).flatMap((rule) => [...rule.declarations]));
}

describe("ledger colour modes in theme.css (dense-ledger-ui.md L1)", () => {
  it("scopes every rule that mentions data-color-mode under html[data-color-mode=\"light\" or \"dark\"]", () => {
    const scoped = rules.filter((rule) => rule.selectors.some((selector) => selector.includes("data-color-mode")));

    expect(scoped.length).toBeGreaterThan(0);
    for (const selector of scoped.flatMap((rule) => rule.selectors)) {
      // Either one mode, or the attribute-presence form the ledger component
      // rules use (L3): any mode, so light and dark share one rule.
      expect(selector).toMatch(/^html\[data-color-mode(="(light|dark)")?\](?![\w-])/);
    }
  });

  it("keeps the ledger out of the MCP Apps' html[data-theme] switch", () => {
    expect(css).not.toMatch(/data-theme/);
  });

  // The Industry set stays the fallback for the VS Code webview and MCP Apps
  // (brand.css duplicates these values and mcp-apps tests pin them).
  it.each([
    ["--color-bg", "#f2f2f3"],
    ["--color-surface", "#e9e9ea"],
    ["--color-text", "#1d1f20"],
    ["--color-accent", "#5980a6"],
    ["--color-accent-text", "#416180"],
    ["--color-accent-fill", "#416180"],
    ["--color-series-1", "#2a78d6"],
    ["--font-body", '"Barlow", system-ui, sans-serif'],
    ["--font-heading", '"Barlow Condensed", system-ui, sans-serif'],
    ["--radius-md", "4px"],
  ])("leaves :root's %s at the Industry %s", (token, value) => {
    expect(root.get(token)).toBe(value);
  });

  it("gives :root the mono and prose font roles, with fallbacks that keep today's rendering", () => {
    expect(root.get("--font-mono")).toBe("ui-monospace, SFMono-Regular, Menlo, Consolas, monospace");
    expect(root.get("--font-prose")).toBe("var(--font-body)");
  });

  // theme-vscode.test.ts wants every derived :root token redeclared for the
  // webview; ledger-only tokens stay out of :root so it gains none.
  it("keeps the ledger-only control border out of :root", () => {
    expect(root.has("--color-control-border")).toBe(false);
  });

  describe.each(MODES)("%s mode", (mode) => {
    const tokens = modeTokens(mode);

    it.each([
      "--color-bg",
      "--color-surface",
      "--color-text",
      "--color-text-muted",
      "--color-accent",
      "--color-accent-2",
      "--color-accent-text",
      "--color-accent-fill",
      "--color-divider",
      "--color-control-border",
      "--color-accent-100",
      "--color-accent-800",
      "--color-accent-900",
      "--color-accent-2-100",
      "--color-accent-2-800",
      "--color-neutral-100",
      "--color-neutral-200",
      "--color-neutral-800",
      "--color-series-1",
      "--color-series-8",
      "--color-status-success",
      "--color-diverging-increase",
      "--color-diverging-decrease",
      "--font-body",
      "--font-heading",
      "--font-mono",
      "--font-prose",
    ])("declares %s", (token) => {
      expect(tokens.has(token), token).toBe(true);
    });

    it("sets the mono stack for the UI and the serif only for prose (D3)", () => {
      expect(tokens.get("--font-mono")).toMatch(/^"Commit Mono", ui-monospace,/);
      expect(tokens.get("--font-body")).toBe("var(--font-mono)");
      expect(tokens.get("--font-heading")).toBe("var(--font-mono)");
      expect(tokens.get("--font-prose")).toMatch(/^"Source Serif 4", Georgia, serif$/);
    });

    it("draws square corners and no shadows", () => {
      for (const radius of ["--radius-sm", "--radius-md", "--radius-lg"]) expect(tokens.get(radius), radius).toBe("0");
      for (const shadow of ["--shadow-sm", "--shadow-md", "--shadow-lg"]) expect(tokens.get(shadow), shadow).toBe("none");
    });

    it("tells native controls and scrollbars which scheme to draw", () => {
      expect(tokens.get("color-scheme")).toBe(mode);
    });
  });

  it("uses the pi.dev-style grounds: parchment in light, canvas in dark", () => {
    expect(modeTokens("light").get("--color-bg")).toBe("#ebe7e4");
    expect(modeTokens("light").get("--color-surface")).toBe("#f4f2f0");
    expect(modeTokens("dark").get("--color-bg")).toBe("#161d27");
    expect(modeTokens("dark").get("--color-surface")).toBe("#212730");
  });
});

// L3: ledger component rules. They use the presence selector so they apply in
// both modes and never reach a host that does not set the attribute.
describe("ledger component rules (dense-ledger-ui.md L3)", () => {
  const ledger = (selector: string): Map<string, string> =>
    new Map(
      rules
        .filter((rule) => rule.selectors.includes(`html[data-color-mode] ${selector}`))
        .flatMap((rule) => [...rule.declarations]),
    );

  it("hides the blueprint corner marks and keeps the hairline border", () => {
    expect(ledger(".blueprint > .corner").get("display")).toBe("none");
    expect(css).toMatch(/\.blueprint\s*\{[^}]*border:\s*1px solid var\(--color-divider\)/);
  });

  it.each([".table th", ".card-kicker", ".stat-tile-label", "h6", ".field > label"])(
    "sets %s as a mono uppercase 11px label with 0.12em tracking",
    (selector) => {
      const declarations = ledger(selector);
      expect(declarations.get("font-family"), selector).toBe("var(--font-mono)");
      expect(declarations.get("font-size")).toBe("11px");
      expect(declarations.get("letter-spacing")).toBe("0.12em");
      expect(declarations.get("text-transform")).toBe("uppercase");
      expect(declarations.get("color")).toBe("var(--color-text-muted)");
    },
  );

  it("sizes body and controls at 12px", () => {
    expect(rules.some((rule) => rule.selectors.includes("html[data-color-mode] body") && rule.declarations.get("font-size") === "12px")).toBe(true);
    for (const selector of [".seg-opt", ".btn", ".input", ".filter-chip"]) {
      expect(ledger(selector).get("font-size"), selector).toBe("12px");
    }
  });

  it.each([
    ["h1", "22px"],
    ["h2", "18px"],
    ["h3", "15px"],
    ["h4", "13px"],
  ])("sets %s mono at %s, weight 600, no tracking", (selector, size) => {
    const declarations = ledger(selector);
    expect(declarations.get("font-size")).toBe(size);
    expect(declarations.get("font-weight")).toBe("600");
    expect(declarations.get("letter-spacing")).toBe("0");
  });

  it.each([".table td", ".stat-tile-value", ".chart-axis-text", ".hbar-value", ".listbox-count"])(
    "gives %s mono tabular numbers",
    (selector) => {
      const declarations = ledger(selector);
      expect(declarations.get("font-family"), selector).toBe("var(--font-mono)");
      expect(declarations.get("font-variant-numeric")).toBe("tabular-nums");
    },
  );

  it("sets KPI values at 16px", () => {
    expect(ledger(".stat-tile-value").get("font-size")).toBe("16px");
  });

  it.each([".insights-narrative", ".explanation-text", ".assumptions-list", ".dialog-body"])(
    "sets %s as serif prose",
    (selector) => {
      const declarations = ledger(selector);
      expect(declarations.get("font-family"), selector).toBe("var(--font-prose)");
      expect(declarations.get("font-size")).toBe("14px");
      expect(declarations.get("line-height")).toBe("1.5");
    },
  );

  it("keeps the KPI footnote mono 11px muted", () => {
    const declarations = ledger(".stat-tiles-footnote");
    expect(declarations.get("font-family")).toBe("var(--font-mono)");
    expect(declarations.get("font-size")).toBe("11px");
    expect(declarations.get("color")).toBe("var(--color-text-muted)");
  });

  // Each axis of a layer is its own gradient: 20px fine and 100px major cells.
  it("draws the graph-paper grid on body only, as fine and major layers", () => {
    const body = rules.find((rule) => rule.selectors.includes("html[data-color-mode] body"))!.declarations;
    expect(body.get("background-image")?.match(/linear-gradient/g)).toHaveLength(4);
    expect(body.get("background-size")).toBe("20px 20px, 20px 20px, 100px 100px, 100px 100px");
    const others = rules.filter((rule) => !rule.selectors.includes("html[data-color-mode] body"));
    for (const rule of others) expect(rule.declarations.get("background-image") ?? "", rule.selectors.join()).not.toMatch(/linear-gradient/);
  });

  it.each([".blueprint", ".card", ".audit-section", ".stat-tile", ".table-scroll"])(
    "keeps the grid out of %s with an opaque ground",
    (selector) => {
      expect(ledger(selector).get("background")).toBe("var(--color-bg)");
    },
  );

  it("keeps selected controls an accent fill with ground-coloured text", () => {
    expect(css).toMatch(/\.seg-opt:has\(input:checked\)\s*\{[^}]*background:\s*var\(--color-accent-fill\);\s*color:\s*var\(--color-bg\)/);
  });

  // Density budgets measured with Commit Mono (Dashboard <= 1470px, KPI tiles
  // <= 80px, Learn turns table without sideways scroll at 1440).
  it("tightens tiles, panels, tables and the turns table to hold the density budgets", () => {
    expect(ledger(".stat-tile").get("padding")).toBe("3px 6px");
    expect(ledger(".stat-tile-note").get("line-height")).toBe("1.1");
    expect(ledger(".audit-section").get("padding")).toBe("6px");
    expect(ledger(".seg-opt").get("padding-inline")).toBe("7px");
    expect(ledger(".table").get("font-size")).toBe("12px");
    expect(ledger(".turns-table td").get("padding")).toBe("4px");
    expect(ledger(".turns-table th").get("font-size")).toBe("10px");
    expect(ledger(".turns-table th").get("letter-spacing")).toBe("0.06em");
  });

  it("uses the mono token, not bare monospace, outside :root's fallback", () => {
    const bare = rules.flatMap((rule) =>
      [...rule.declarations].filter(([property, value]) => property === "font-family" && /(^|[\s,])monospace$/.test(value) && !value.startsWith("var(")).map(() => rule.selectors.join(",")),
    );
    expect(bare).toEqual([]);
  });
});
