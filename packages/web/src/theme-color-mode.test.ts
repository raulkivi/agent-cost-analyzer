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
      expect(selector).toMatch(/^html\[data-color-mode="(light|dark)"\](?![\w-])/);
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
