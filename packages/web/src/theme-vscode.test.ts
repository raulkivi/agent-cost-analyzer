// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = path.dirname(fileURLToPath(import.meta.url));
const VSCODE_THEME_PATH = path.join(srcDir, "theme-vscode.css");

// The classes VS Code puts on a webview's <body> for the active theme kind.
const VSCODE_BODY_CLASSES = ["vscode-light", "vscode-dark", "vscode-high-contrast"];

interface Rule {
  selectors: string[];
  declarations: Map<string, string>;
}

// Enough of a CSS parser for flat stylesheets: comments stripped, one level
// of `selector { declarations }`, and any at-rule reported as a selector so
// the scoping check below rejects it.
function parseRules(css: string): Rule[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Rule[] = [];
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = new Map<string, string>();
    for (const declaration of match[2]!.split(";")) {
      const colon = declaration.indexOf(":");
      if (colon > 0) {
        declarations.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
      }
    }
    rules.push({ selectors: match[1]!.split(",").map((selector) => selector.trim()), declarations });
  }
  return rules;
}

function readVscodeTheme(): string {
  return readFileSync(VSCODE_THEME_PATH, "utf-8");
}

// The rule that sets theme.css's tokens on the body: selected by every
// VS Code theme class, so one declaration covers all of them.
function tokenRule(rules: Rule[]): Rule {
  const rule = rules.find((candidate) => candidate.declarations.has("--color-bg"));
  if (!rule) throw new Error("no rule maps --color-bg");
  return rule;
}

// Every declaration that mentions a given --vscode-* variable.
function declarationsUsing(rules: Rule[], variable: string): string[] {
  return rules.flatMap((rule) =>
    [...rule.declarations].filter(([, value]) => value.includes(`var(${variable}`)).map(([name]) => name),
  );
}

describe("VS Code theme mapping (vscode-extension.md step 10.5)", () => {
  it("lives in its own stylesheet, next to theme.css", () => {
    expect(existsSync(VSCODE_THEME_PATH)).toBe(true);
  });

  it("scopes every rule under a VS Code body theme class, so the standalone app gains no effective rule", () => {
    const rules = parseRules(readVscodeTheme());

    expect(rules.length).toBeGreaterThan(0);
    for (const selector of rules.flatMap((rule) => rule.selectors)) {
      expect(selector).toMatch(/^body\.vscode-(light|dark|high-contrast)(?![\w-])/);
    }
  });

  it("selects the token rule with each theme class", () => {
    const { selectors } = tokenRule(parseRules(readVscodeTheme()));

    for (const bodyClass of VSCODE_BODY_CLASSES) {
      expect(selectors).toContain(`body.${bodyClass}`);
    }
  });

  it.each([
    ["--color-bg", "--vscode-editor-background"],
    ["--color-text", "--vscode-editor-foreground"],
    ["--color-surface", "--vscode-input-background"],
    ["--color-divider", "--vscode-panel-border"],
    ["--color-accent", "--vscode-button-background"],
    ["--font-body", "--vscode-font-family"],
    ["--font-heading", "--vscode-font-family"],
    ["font-size", "--vscode-font-size"],
  ])("maps %s to %s", (token, variable) => {
    expect(tokenRule(parseRules(readVscodeTheme())).declarations.get(token)).toMatch(new RegExp(`^var\\(${variable},`));
  });

  it.each([
    ["--vscode-descriptionForeground", ".text-muted", "color"],
    ["--vscode-focusBorder", ":focus-visible", "outline-color"],
    ["--vscode-button-foreground", ".btn-primary", "color"],
    ["--vscode-input-border", ".input", "border-color"],
    ["--vscode-list-activeSelectionBackground", ".listbox-value--selected", "background"],
    ["--vscode-list-activeSelectionForeground", ".listbox-value--selected", "color"],
  ])("uses %s for %s's %s", (variable, className, property) => {
    const rules = parseRules(readVscodeTheme());
    const rule = rules.find((candidate) => candidate.selectors.some((selector) => selector.endsWith(` ${className}`)));

    expect(rule?.declarations.get(property)).toContain(`var(${variable}`);
    expect(declarationsUsing(rules, variable)).toContain(property);
  });

  // A custom property's var() resolves where it's declared: a :root token
  // derived from --color-text would keep the Industry text colour on body,
  // where the webview's own --color-text lives, unless it's declared again.
  it("redeclares every theme.css token that derives from another token", () => {
    const standalone = parseRules(readFileSync(path.join(srcDir, "theme.css"), "utf-8"));
    const root = standalone.find((rule) => rule.selectors.includes(":root"));
    const derived = [...(root?.declarations ?? [])].filter(([, value]) => value.includes("var(--color-")).map(([name]) => name);
    const { declarations } = tokenRule(parseRules(readVscodeTheme()));

    expect(derived.length).toBeGreaterThan(0);
    for (const name of derived) {
      expect(declarations.has(name), name).toBe(true);
    }
  });

  it.each([
    ["--color-text-muted", "--vscode-descriptionForeground"],
    ["--color-accent-text", "--vscode-textLink-foreground"],
    ["--color-accent-fill", "--vscode-button-background"],
  ])("maps the text-safe role %s to %s", (token, variable) => {
    expect(tokenRule(parseRules(readVscodeTheme())).declarations.get(token)).toMatch(new RegExp(`^var\\(${variable},`));
  });

  // §3.5: focus is always visible in the editor's own focus colour. A more
  // specific theme.css focus rule would otherwise outrank the generic one.
  it("gives every theme.css focus outline the editor's focus border colour", () => {
    const standalone = parseRules(readFileSync(path.join(srcDir, "theme.css"), "utf-8"));
    const vscode = parseRules(readVscodeTheme());
    const focusSelectors = standalone
      .flatMap((rule) => rule.selectors)
      .filter((selector) => selector.includes(":focus-visible") && !selector.startsWith("@"));

    expect(focusSelectors.length).toBeGreaterThan(0);
    for (const selector of focusSelectors) {
      for (const bodyClass of VSCODE_BODY_CLASSES) {
        const rule = vscode.find((candidate) => candidate.selectors.includes(`body.${bodyClass} ${selector}`));
        const mapped = [...(rule?.declarations.values() ?? [])].some((value) => value.includes("var(--vscode-focusBorder"));
        expect(mapped, `body.${bodyClass} ${selector}`).toBe(true);
      }
    }
  });

  it("falls back to the Industry palette wherever a --vscode-* variable is missing", () => {
    const uses = readVscodeTheme().match(/var\(--vscode-[\w-]+[^)]?/g) ?? [];

    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) {
      expect(use).toMatch(/,$/);
    }
  });

  it("leaves theme.css, the standalone look, free of any VS Code variable or class", () => {
    const standalone = readFileSync(path.join(srcDir, "theme.css"), "utf-8");

    expect(standalone).not.toMatch(/vscode/i);
  });

  it("is loaded after theme.css, so its tokens win", () => {
    const main = readFileSync(path.join(srcDir, "main.tsx"), "utf-8");

    expect(main.indexOf('import "./theme-vscode.css"')).toBeGreaterThan(main.indexOf('import "./theme.css"'));
    expect(main.indexOf('import "./theme.css"')).toBeGreaterThanOrEqual(0);
  });
});
