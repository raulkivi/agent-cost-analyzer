// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
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
// for the standalone app (theme.css, its Industry :root and the ledger's
// light and dark colour modes, dense-ledger-ui.md L1), for a webview whose
// theme defines none of the --vscode-* variables (theme-vscode.css's
// fallbacks), and for VS Code's own default themes (Dark Modern, Light
// Modern, High Contrast): step 10.11 found text that only failed with a
// real theme's colours.

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

type Theme =
  | "standalone"
  | "standalone-light"
  | "standalone-dark"
  | "vscode-fallback"
  | "vscode-dark-modern"
  | "vscode-light-modern"
  | "vscode-high-contrast";

// The ledger's colour modes: theme.css rules under html[data-color-mode],
// which only the standalone app sets (dense-ledger-ui.md D1).
const COLOR_MODES: Partial<Record<Theme, "light" | "dark">> = { "standalone-light": "light", "standalone-dark": "dark" };

function colorModeScope(theme: Theme): string | undefined {
  const mode = COLOR_MODES[theme];
  return mode ? `html[data-color-mode="${mode}"]` : undefined;
}

// The --vscode-* variables VS Code's default themes give a webview (the
// ones theme-vscode.css reads; the extension's UI check uses the same).
const VSCODE_THEME_VARS: Partial<Record<Theme, { bodyClass: string; vars: Record<string, string> }>> = {
  "vscode-dark-modern": {
    bodyClass: "vscode-dark",
    vars: {
      "--vscode-editor-background": "#1f1f1f",
      "--vscode-editor-foreground": "#cccccc",
      "--vscode-input-background": "#313131",
      "--vscode-input-border": "#3c3c3c",
      "--vscode-input-foreground": "#cccccc",
      "--vscode-panel-border": "#2b2b2b",
      "--vscode-button-background": "#0078d4",
      "--vscode-button-foreground": "#ffffff",
      "--vscode-button-hoverBackground": "#026ec1",
      "--vscode-descriptionForeground": "#9d9d9d",
      "--vscode-textLink-foreground": "#4daafc",
      "--vscode-focusBorder": "#0078d4",
      "--vscode-list-activeSelectionBackground": "#04395e",
      "--vscode-list-activeSelectionForeground": "#ffffff",
      "--vscode-errorForeground": "#f85149",
    },
  },
  "vscode-light-modern": {
    bodyClass: "vscode-light",
    vars: {
      "--vscode-editor-background": "#ffffff",
      "--vscode-editor-foreground": "#3b3b3b",
      "--vscode-input-background": "#ffffff",
      "--vscode-input-border": "#cecece",
      "--vscode-input-foreground": "#3b3b3b",
      "--vscode-panel-border": "#e5e5e5",
      "--vscode-button-background": "#005fb8",
      "--vscode-button-foreground": "#ffffff",
      "--vscode-button-hoverBackground": "#0258a8",
      "--vscode-descriptionForeground": "#3b3b3b",
      "--vscode-textLink-foreground": "#005fb8",
      "--vscode-focusBorder": "#005fb8",
      "--vscode-list-activeSelectionBackground": "#e8e8e8",
      "--vscode-list-activeSelectionForeground": "#000000",
      "--vscode-errorForeground": "#f85149",
    },
  },
  "vscode-high-contrast": {
    bodyClass: "vscode-high-contrast",
    vars: {
      "--vscode-editor-background": "#000000",
      "--vscode-editor-foreground": "#ffffff",
      "--vscode-input-background": "#000000",
      "--vscode-input-border": "#6fc3df",
      "--vscode-input-foreground": "#ffffff",
      "--vscode-panel-border": "#6fc3df",
      "--vscode-contrastBorder": "#6fc3df",
      "--vscode-button-background": "#000000",
      "--vscode-button-foreground": "#ffffff",
      "--vscode-descriptionForeground": "#ffffff",
      "--vscode-textLink-foreground": "#21a6ff",
      "--vscode-focusBorder": "#f38518",
      "--vscode-list-activeSelectionBackground": "#000000",
      "--vscode-list-activeSelectionForeground": "#ffffff",
      "--vscode-errorForeground": "#f48771",
    },
  },
};

function bodyClassOf(theme: Theme): string | undefined {
  if (theme.startsWith("standalone")) return undefined;
  return VSCODE_THEME_VARS[theme]?.bodyClass ?? "vscode-dark";
}

// The last declaration of `property` for `selector`; in a webview,
// theme-vscode.css's `body.vscode-dark <selector>` rule wins, and in a
// colour mode theme.css's `html[data-color-mode="…"] <selector>` or
// `html[data-color-mode] <selector>` rule. Both forms have the same
// specificity, so the later one in source order wins.
function declared(theme: Theme, selector: string, property: string): string | undefined {
  const lookup = (rules: Rule[], ...wanted: string[]) =>
    rules
      .filter((rule) => wanted.some((one) => rule.selectors.includes(one)) && rule.declarations.has(property))
      .at(-1)
      ?.declarations.get(property);
  const base = lookup(standaloneRules, selector);
  const scope = colorModeScope(theme);
  if (scope) return lookup(standaloneRules, `${scope} ${selector}`, `html[data-color-mode] ${selector}`) ?? base;
  const bodyClass = bodyClassOf(theme);
  return bodyClass ? (lookup(vscodeRules, `body.${bodyClass} ${selector}`) ?? base) : base;
}

function tokens(theme: Theme): Record<string, string> {
  const root = Object.fromEntries(standaloneRules.find((rule) => rule.selectors.includes(":root"))!.declarations);
  const scope = colorModeScope(theme);
  if (scope) {
    const mode = standaloneRules.filter((rule) => rule.selectors.includes(scope)).flatMap((rule) => [...rule.declarations]);
    return { ...root, ...Object.fromEntries(mode) };
  }
  const bodyClass = bodyClassOf(theme);
  if (!bodyClass) return root;
  // Every rule on the bare body class, in source order: the shared token
  // rule first, then per-theme ones such as the series steps (§11.7).
  const body = vscodeRules
    .filter((rule) => rule.selectors.includes(`body.${bodyClass}`))
    .flatMap((rule) => [...rule.declarations]);
  return { ...root, ...Object.fromEntries(body), ...(VSCODE_THEME_VARS[theme]?.vars ?? {}) };
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

const THEMES: Theme[] = ["standalone", "standalone-light", "standalone-dark", "vscode-fallback", "vscode-dark-modern", "vscode-light-modern", "vscode-high-contrast"];
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

  it.each([".btn-primary", ".seg-opt:has(input:checked)", '.filter-chip[aria-pressed="true"]', ".replay-channel--on"])(
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

// The categorical palette (cost-by-repository-and-project.md §11.7): eight
// identity colours in a fixed order, the dataviz reference palette, light
// steps on light grounds and dark steps on dark ones. They colour marks,
// not text, so the bar is WCAG 1.4.11's 3:1 for graphics.
describe("categorical series palette (cost-by-repository-and-project.md §11.7)", () => {
  const GRAPHICS = 3;
  const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
  const HUES = ["blue", "orange", "aqua", "yellow", "magenta", "green", "violet", "red"] as const;
  // Light steps: slots 2-5 (orange, aqua, yellow, magenta) are darkened so every
  // slot reaches 3:1 on a light ground too (step 10.17 G7, check 1.8).
  const LIGHT = ["#2a78d6", "#d4551f", "#118a60", "#9c6f00", "#c2417a", "#008300", "#6250d6", "#e34948"];
  const DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
  // The ledger's light mode sits on parchment (#ebe7e4), darker than the
  // Industry ground; the light steps still reach 3:1 there (lowest: red,
  // 3.2:1), so it pins them too. Its dark mode reuses the dark steps.
  const LEDGER_LIGHT = LIGHT;
  const SERIES_THEMES: { theme: Theme; steps: string[]; light: boolean; dashed: boolean }[] = [
    { theme: "standalone", steps: LIGHT, light: true, dashed: false },
    { theme: "standalone-light", steps: LEDGER_LIGHT, light: true, dashed: false },
    { theme: "standalone-dark", steps: DARK, light: false, dashed: false },
    { theme: "vscode-light-modern", steps: LIGHT, light: true, dashed: false },
    { theme: "vscode-dark-modern", steps: DARK, light: false, dashed: false },
    { theme: "vscode-high-contrast", steps: DARK, light: false, dashed: true },
  ];

  describe.each(SERIES_THEMES)("$theme", ({ theme, steps, dashed }) => {
    const value = (token: string) => tokens(theme)[token]?.toLowerCase();

    it("defines --color-series-1 to -8 in the fixed order", () => {
      expect(SLOTS.map((slot) => value(`--color-series-${slot}`))).toEqual(steps);
    });

    it.each(SLOTS.map((slot) => [slot, HUES[slot - 1]!] as const))("series %i (%s) reaches 3:1 against the page", (slot) => {
      expect(ratio(theme, `var(--color-series-${slot})`, "var(--color-bg)")).toBeGreaterThanOrEqual(GRAPHICS);
    });

    it("waterfall increases and decreases (the diverging pair) differ and reach 3:1 on the page", () => {
      expect(value("--color-diverging-increase")).toBeDefined();
      expect(value("--color-diverging-decrease")).toBeDefined();
      expect(value("--color-diverging-increase")).not.toBe(value("--color-diverging-decrease"));
      expect(ratio(theme, "var(--color-diverging-increase)", "var(--color-bg)")).toBeGreaterThanOrEqual(GRAPHICS);
      expect(ratio(theme, "var(--color-diverging-decrease)", "var(--color-bg)")).toBeGreaterThanOrEqual(GRAPHICS);
    });

    it(dashed ? "series also differ by dash pattern (solid, 7 4, 2 3, in turn)" : "series lines are solid", () => {
      const expected = SLOTS.map((slot) => (dashed ? ["none", "7 4", "2 3"][(slot - 1) % 3] : "none"));
      expect(SLOTS.map((slot) => value(`--dash-series-${slot}`))).toEqual(expected);
    });
  });

  it("uses the light steps in a light High Contrast theme, whose body carries vscode-high-contrast too", () => {
    const declarations = Object.fromEntries(
      vscodeRules
        .filter((rule) => rule.selectors.includes("body.vscode-high-contrast.vscode-high-contrast-light"))
        .flatMap((rule) => [...rule.declarations]),
    );
    expect(SLOTS.map((slot) => declarations[`--color-series-${slot}`]?.toLowerCase())).toEqual(LIGHT);
    expect(declarations["--color-diverging-increase"]?.toLowerCase()).toBe("#e34948");
    expect(declarations["--color-diverging-decrease"]?.toLowerCase()).toBe("#1c5cab");
  });

  // VS Code's own charts.* colours fall outside the lightness band on Dark
  // Modern (§11.7's correction), so no series follows them.
  it("never maps a series or diverging token to --vscode-charts-*", () => {
    const mapped = vscodeRules.flatMap((rule) =>
      [...rule.declarations]
        .filter(([name, declaredValue]) => /^--(color|dash)-(series|diverging)/.test(name) && declaredValue.includes("--vscode-charts"))
        .map(([name]) => name),
    );
    expect(mapped).toEqual([]);
  });

  // Tool-call status marks (step 10.17 G7): one value per status that reaches
  // 3:1 on every ground, so the same hex serves light, dark and both High
  // Contrast themes. Status is also told by pattern and icon, never colour alone.
  const STATUS_THEMES = ["standalone", "standalone-light", "standalone-dark", "vscode-light-modern", "vscode-dark-modern", "vscode-high-contrast"] as const;
  describe.each(STATUS_THEMES)("status colours in %s", (theme) => {
    it.each(["success", "error", "interrupted", "denied", "unknown"])("%s reaches 3:1 against the page", (status) => {
      expect(ratio(theme, `var(--color-status-${status})`, "var(--color-bg)")).toBeGreaterThanOrEqual(GRAPHICS);
    });
  });

  // A ninth series folds into "Other" (§11.6), never a generated hue.
  it("defines no ninth series colour", () => {
    const names = [...standaloneRules, ...vscodeRules].flatMap((rule) => [...rule.declarations.keys()]);
    expect(names.filter((name) => /^--color-series-(9|\d{2,})$/.test(name))).toEqual([]);
  });
});

// Phase 16 SR16: the savings bars (SavingsRow.tsx) draw the likely low end
// solid and the possible rest hatched. The words carry the meaning, but the
// two parts must still be told apart without colour: the hatch is the cue,
// so its stripes and the solid fill reach WCAG 1.4.11's 3:1 on the track.
describe("savings bars (SR16)", () => {
  const GRAPHICS = 3;
  const firstColour = (value: string | undefined): string => {
    const match = /var\(--[a-z0-9-]+\)/.exec(value ?? "");
    if (!match) throw new Error(`no colour token in ${value}`);
    return match[0];
  };

  describe.each(THEMES)("%s", (theme) => {
    const track = () => declared(theme, ".savings-bar", "background") ?? "";

    it("the solid part reaches 3:1 on the track", () => {
      expect(ratio(theme, firstColour(declared(theme, ".savings-bar-sure", "background")), track())).toBeGreaterThanOrEqual(GRAPHICS);
    });

    it.each([".savings-bar-maybe", ".savings-bar--sim .savings-bar-maybe"])("the hatch stripes of %s reach 3:1 on the track", (selector) => {
      expect(ratio(theme, firstColour(declared(theme, selector, "background")), track())).toBeGreaterThanOrEqual(GRAPHICS);
    });
  });
});

// The ledger's hairlines are faint by design, so the boundaries a reader
// needs to find a control or the focus carry WCAG 1.4.11's 3:1 instead: the
// input border and the accent (focus outline, caret, marks) on the page and
// on panels.
describe.each(["standalone-light", "standalone-dark"] as const)("ledger boundaries, %s", (theme) => {
  const GRAPHICS = 3;
  const PANEL_GROUNDS = ["var(--color-bg)", "var(--color-surface)"];

  // Through a token, not a scoped .input rule: that would outrank
  // .input:hover and .input:focus-visible and hide their feedback.
  it("draws the input border in --color-control-border, the hairline where it is unset", () => {
    expect(declared(theme, ".input", "border")).toContain("var(--color-control-border, var(--color-divider))");
  });

  it.each(PANEL_GROUNDS)("the control border reaches 3:1 on %s", (ground) => {
    expect(ratio(theme, "var(--color-control-border)", ground)).toBeGreaterThanOrEqual(GRAPHICS);
  });

  it.each(PANEL_GROUNDS)("the accent reaches 3:1 on %s", (ground) => {
    expect(ratio(theme, "var(--color-accent)", ground)).toBeGreaterThanOrEqual(GRAPHICS);
  });

  // L6: a segmented control's focus ring is drawn inside the option, and
  // keyboard focus lands on the checked one, whose fill is --color-accent-fill.
  // An accent ring there was 1:1 in dark and 1.3:1 in light: invisible.
  it("the focus ring on a checked segment reaches 3:1 on its fill", () => {
    const ring = declared(theme, ".seg-opt:has(input:checked)", "outline-color");
    expect(ring).toBeDefined();
    expect(ratio(theme, ring!, "var(--color-accent-fill)")).toBeGreaterThanOrEqual(GRAPHICS);
  });
});

// The L3 component rules use the attribute-presence form
// html[data-color-mode] <selector> (both modes); the harness must resolve
// them, or a colour they set goes unchecked and the base rule's is checked
// instead.
describe("contrast harness resolves the ledger's shared component rules", () => {
  it.each(["standalone-light", "standalone-dark"] as const)("reads html[data-color-mode] .card-kicker in %s", (theme) => {
    expect(declared(theme, ".card-kicker", "color")).toBe("var(--color-text-muted)");
  });

  it("keeps the base rule outside the colour modes", () => {
    expect(declared("standalone", ".card-kicker", "color")).toBe("var(--color-accent-text)");
  });
});
