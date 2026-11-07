// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cascadeVars, parseRules } from "./css-vars.js";
import { BRAND_CSS, HOST_CSS, SHEETS, THEME_CSS } from "./host-sets.js";

// Plan §5.2 / §5.4: how the three stylesheets are layered.

const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const declared = (css: string, selector: string) =>
  new Map(parseRules(css).filter((rule) => rule.selectors.includes(selector)).flatMap((rule) => rule.declarations));
const HTML_APP = 'html[data-host="mcp-app"]';

describe("theme-mcp-host.css", () => {
  const host = declared(HOST_CSS, HTML_APP);

  it("is scoped under html[data-host=\"mcp-app\"] and nothing else", () => {
    const selectors = parseRules(HOST_CSS).flatMap((rule) => rule.selectors);
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) expect(selector.startsWith(HTML_APP), selector).toBe(true);
  });

  it("re-points the Industry tokens at the spec's host variables, each with a fallback", () => {
    const expected: Record<string, string> = {
      "--color-text": "--color-text-primary",
      "--color-text-muted": "--color-text-secondary",
      "--color-surface": "--color-background-secondary",
      "--color-divider": "--color-border-primary",
      "--font-body": "--font-sans",
      "--radius-sm": "--border-radius-sm",
      "--radius-md": "--border-radius-md",
      "--radius-lg": "--border-radius-lg",
    };
    for (const [token, hostVariable] of Object.entries(expected)) {
      expect(host.get(token), token).toMatch(new RegExp(`^var\\(${hostVariable}, .+\\)$`));
    }
  });

  it("makes the page transparent and lets the host pick the scheme", () => {
    expect(host.get("--color-bg")).toBe("transparent");
    expect(host.get("color-scheme")).toBe("light dark");
  });

  it("holds no colour literal: the brand and fallback values live in brand.css", () => {
    expect(strip(HOST_CSS)).not.toMatch(COLOUR_LITERAL);
  });
});

describe("brand.css", () => {
  it("switches on the document theme applyDocumentTheme sets, not on the OS preference", () => {
    expect(BRAND_CSS).not.toMatch(/prefers-color-scheme/);
    expect(BRAND_CSS).toContain(`${HTML_APP}[data-theme="dark"]`);
  });

  it("is scoped under html[data-host=\"mcp-app\"]", () => {
    for (const selector of parseRules(BRAND_CSS).flatMap((rule) => rule.selectors)) expect(selector.startsWith(HTML_APP), selector).toBe(true);
  });

  it("gives every brand token a light and a dark value", () => {
    const light = declared(BRAND_CSS, HTML_APP);
    const dark = declared(BRAND_CSS, `${HTML_APP}[data-theme="dark"]`);
    const names = [...light.keys()].filter((name) => name.startsWith("--brand-"));
    expect(names).toEqual(expect.arrayContaining(["--brand-mark", "--brand-accent", "--brand-accent-text", "--brand-accent-fill", "--brand-on-accent", "--brand-accent-strong"]));
    for (const name of names) expect(dark.has(name), name).toBe(true);
  });

  it("keeps the light brand ramp and fallbacks on the Industry palette of theme.css", () => {
    const industry = cascadeVars([THEME_CSS], { theme: "light", hostVars: {}, markedAsApp: false });
    const light = cascadeVars(SHEETS, { theme: "light", hostVars: {} });
    expect(light["--brand-accent"]).toBe(industry["--color-accent"]);
    expect(light["--brand-accent-text"]).toBe(industry["--color-accent-text"]);
    expect(light["--brand-accent-fill"]).toBe(industry["--color-accent-fill"]);
    expect(light["--brand-accent-strong"]).toBe(industry["--color-accent-800"]);
    expect(light["--brand-fb-text"]).toBe(industry["--color-text"]);
    expect(light["--brand-fb-ground"]).toBe(industry["--color-bg"]);
    expect(light["--brand-fb-surface"]).toBe(industry["--color-surface"]);
  });
});

describe("the whole view entry", () => {
  it("imports the three stylesheets in cascade order", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const main = readFileSync(path.join(here, "../../src/main.tsx"), "utf8");
    const order = ["@agent-cost-analyzer/web/theme.css", "./theme/brand.css", "./theme/theme-mcp-host.css"].map((specifier) => main.indexOf(`"${specifier}"`));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
