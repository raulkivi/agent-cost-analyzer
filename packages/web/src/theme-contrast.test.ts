// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contrastRatio, resolveCssColor, type Rgb } from "./lib/contrast.js";
import { PAYLOAD_TOKEN_COLORS } from "./lib/turn-payload-pretty.js";

// Text contrast of the theme's own colour pairs (vscode-extension.md §3.5:
// at least 4.5:1). jsdom computes no colours, so axe's color-contrast rule
// can't run in the component tests; this checks the stylesheets instead,
// for the standalone app (theme.css) and for a webview whose theme defines
// none of the --vscode-* variables (theme-vscode.css's fallbacks). A real
// VS Code theme's own colours are its author's to keep legible.

const srcDir = path.dirname(fileURLToPath(import.meta.url));
const AA_TEXT = 4.5;

interface Rule {
  selectors: string[];
  declarations: Map<string, string>;
}

// Flat rules only, like theme-vscode.test.ts; the inner rules of an
// @media block come out with the at-rule glued to their first selector,
// which no lookup below asks for.
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

const standaloneRules = parseRules(readFileSync(path.join(srcDir, "theme.css"), "utf-8"));
const vscodeRules = parseRules(readFileSync(path.join(srcDir, "theme-vscode.css"), "utf-8"));

type Theme = "standalone" | "vscode-fallback";

// The last declaration of `property` for `selector`; in a webview,
// theme-vscode.css's `body.vscode-dark <selector>` rule wins.
function declared(theme: Theme, selector: string, property: string): string | undefined {
  const lookup = (rules: Rule[], wanted: string) =>
    rules.filter((rule) => rule.selectors.includes(wanted) && rule.declarations.has(property)).at(-1)?.declarations.get(property);
  const base = lookup(standaloneRules, selector);
  return theme === "vscode-fallback" ? (lookup(vscodeRules, `body.vscode-dark ${selector}`) ?? base) : base;
}

function tokens(theme: Theme): Record<string, string> {
  const root = Object.fromEntries(standaloneRules.find((rule) => rule.selectors.includes(":root"))!.declarations);
  if (theme === "standalone") return root;
  const body = vscodeRules.find((rule) => rule.selectors.includes("body.vscode-dark") && rule.declarations.has("--color-bg"))!;
  return { ...root, ...Object.fromEntries(body.declarations) };
}

function color(theme: Theme, value: string, backdrop?: Rgb): Rgb {
  return resolveCssColor(value, { vars: tokens(theme), backdrop });
}

// Text colour `foreground` (a CSS value) on `ground` (a CSS value).
function ratio(theme: Theme, foreground: string, ground: string): number {
  const groundRgb = color(theme, ground, color(theme, "var(--color-bg)"));
  return contrastRatio(color(theme, foreground, groundRgb), groundRgb);
}

// A class's text colour on its own background (or the page's).
function ruleRatio(theme: Theme, selector: string, ground?: string, colorProperty = "color"): number {
  const foreground = declared(theme, selector, colorProperty);
  if (!foreground) throw new Error(`${selector} sets no ${colorProperty}`);
  const background = ground ?? declared(theme, selector, "background") ?? "var(--color-bg)";
  return ratio(theme, foreground, background);
}

const THEMES: Theme[] = ["standalone", "vscode-fallback"];
// Every ground muted or accent text sits on: the page, inputs and list-box
// headers, and selected rows, cards and the config banner.
const GROUNDS = ["var(--color-bg)", "var(--color-surface)", "var(--color-accent-100)"];

describe.each(THEMES)("theme contrast, %s", (theme) => {
  it("body text on the page", () => {
    expect(ratio(theme, "var(--color-text)", "var(--color-bg)")).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(GROUNDS)("muted text (--color-text-muted and .text-muted) on %s", (ground) => {
    expect(ratio(theme, "var(--color-text-muted)", ground)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(ruleRatio(theme, ".text-muted", ground)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(GROUNDS)("accent text (--color-accent-text: links, kickers, ghost buttons) on %s", (ground) => {
    expect(ratio(theme, "var(--color-accent-text)", ground)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each([".btn-primary", ".seg-opt:has(input:checked)", '.filter-chip[aria-pressed="true"]'])(
    "button text on its button background (%s)",
    (selector) => {
      expect(ruleRatio(theme, selector)).toBeGreaterThanOrEqual(AA_TEXT);
    },
  );

  it.each([
    "a",
    ".btn-ghost",
    ".tag-outline",
    ".card-kicker",
    ".tag-accent",
    ".tag-accent-2",
    ".tag-neutral",
    ".table th",
    ".field > label",
    ".card-meta",
    ".stat-tile-label",
    ".stat-tile-note",
    ".stat-tile-value--alert",
    ".failure-badge",
    ".hbar-value",
    ".findings-evidence",
    ".listbox-value--selected",
    ".listbox-value--alternative",
    ".listbox-value--excluded",
    ".selection-chip",
    ".severity-tag--critical",
    ".severity-tag--high",
    ".severity-tag--medium",
    ".severity-tag--low",
    ".severity-tag--info",
  ])("%s text on its background", (selector) => {
    expect(ruleRatio(theme, selector)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  // White at 75% on the selected value's green is 3.6:1.
  it("list-box counts aren't dimmed with opacity on the coloured value grounds", () => {
    expect(declared(theme, ".listbox-count", "opacity")).toBeUndefined();
  });

  it("chart axis text on the page", () => {
    expect(ruleRatio(theme, ".chart-axis-text", undefined, "fill")).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(Object.entries(PAYLOAD_TOKEN_COLORS))("turn inspector payload %s tokens on the page", (_kind, value) => {
    expect(ratio(theme, value, "var(--color-bg)")).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

// Inline text colours in components, which the stylesheet checks above
// don't see: a muted mix weaker than --color-text-muted's, or the
// decorative --color-accent, would fall under 4.5:1.
describe("inline text colours in components", () => {
  const sources = readdirSync(srcDir, { recursive: true, encoding: "utf-8" })
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .map((file) => [file, readFileSync(path.join(srcDir, file), "utf-8")] as const);

  it("mix --color-text with at least --color-text-muted's 70%", () => {
    const weak = sources.flatMap(([file, text]) =>
      [...text.matchAll(/color:\s*"color-mix\(in srgb, var\(--color-text\) (\d+)%/g)]
        .filter((match) => Number(match[1]) < 70)
        .map((match) => `${file}: ${match[0]}`),
    );
    expect(weak).toEqual([]);
  });

  it("never colour text with the decorative --color-accent or its lighter ramp steps", () => {
    const decorative = sources.flatMap(([file, text]) =>
      [...text.matchAll(/color:\s*"var\(--color-accent(-[2-6]00)?\)"/g)].map((match) => `${file}: ${match[0]}`),
    );
    expect(decorative).toEqual([]);
  });
});
