// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = path.dirname(fileURLToPath(import.meta.url));

function readTheme(): string {
  return readFileSync(path.join(srcDir, "theme.css"), "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");
}

// The body of the first `@media <query> { … }` block, nested braces and all.
function mediaBlock(css: string, query: RegExp): string | undefined {
  const match = new RegExp(`@media\\s*${query.source}\\s*\\{`).exec(css);
  if (!match) return undefined;
  let depth = 1;
  let index = match.index + match[0].length;
  const start = index;
  while (depth > 0 && index < css.length) {
    if (css[index] === "{") depth++;
    if (css[index] === "}") depth--;
    index++;
  }
  return css.slice(start, index - 1);
}

describe("theme.css (vscode-extension.md §3.5)", () => {
  it("loads no remote stylesheet or font (constraint 1, G12)", () => {
    const css = readTheme();

    expect(css).not.toContain("fonts.googleapis.com");
    expect(css).not.toMatch(/@import[^;]*(https?:)?\/\//);
  });

  // The medium layout's side drawer is fixed over the page; a modal dialog
  // opened while it's open must sit above it.
  it("stacks the dialog backdrop above the side drawer", () => {
    const css = readTheme();
    const zIndex = (selector: string) =>
      Number(new RegExp(`${selector.replace(/[.-]/g, "\\$&")}\\s*\\{[^}]*z-index:\\s*(\\d+)`).exec(css)?.[1] ?? NaN);

    expect(zIndex(".dialog-backdrop")).toBeGreaterThan(zIndex(".drawer--side"));
  });

  describe("reduced motion", () => {
    const block = () => mediaBlock(readTheme(), /\(prefers-reduced-motion:\s*reduce\)/);

    it("has a prefers-reduced-motion: reduce block", () => {
      expect(block()).toBeDefined();
    });

    it("turns off every transition and animation, including progress animation, on every element", () => {
      const css = block() ?? "";

      expect(css).toMatch(/\*\s*,\s*\*::before\s*,\s*\*::after\s*\{/);
      expect(css).toMatch(/transition:\s*none\s*!important/);
      expect(css).toMatch(/animation:\s*none\s*!important/);
    });

    it("turns off smooth scrolling", () => {
      expect(block() ?? "").toMatch(/scroll-behavior:\s*auto\s*!important/);
    });
  });
});
