// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { resolveCssColor, type Rgb } from "@agent-cost-analyzer/web/lib/contrast";

// A small reader for the custom properties the MCP App theme sets on <html>.
// jsdom computes no colours, so the contrast tests read the real stylesheets
// with this instead: it applies the rules that match <html> (:root and
// html[data-host][data-theme]) in cascade order, lets the host's inline
// variables win, and resolves a colour through var(), color-mix(),
// light-dark() and rgba().

export type Theme = "light" | "dark";

export interface Rule {
  selectors: string[];
  declarations: [string, string][];
}

// Flat rules only; the theme files declare no nested rules on <html>.
export function parseRules(css: string): Rule[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => {
    const declarations: [string, string][] = [];
    for (const declaration of match[2]!.split(";")) {
      const colon = declaration.indexOf(":");
      if (colon > 0) declarations.push([declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()]);
    }
    return { selectors: match[1]!.split(",").map((selector) => selector.trim()), declarations };
  });
}

export interface Environment {
  // hostContext.theme, which applyDocumentTheme puts on <html data-theme>.
  theme: Theme;
  // The host's inline variables (applyHostStyleVariables), by name.
  hostVars: Record<string, string>;
  // False renders the page without data-host, like the standalone app.
  markedAsApp?: boolean;
}

// Specificity of a root-element selector, or undefined when it can't match
// <html> in this environment. ":root" counts as one class, "html" as one type.
function specificity(selector: string, env: Environment): number | undefined {
  const match = /^(:root|html)((?:\[[^\]]+\])*)$/.exec(selector);
  if (!match) return undefined;
  const attributes = { "data-host": env.markedAsApp === false ? undefined : "mcp-app", "data-theme": env.theme } as Record<string, string | undefined>;
  const tests = [...match[2]!.matchAll(/\[([\w-]+)="([^"]*)"\]/g)];
  if (tests.length !== (match[2]!.match(/\[/g) ?? []).length) return undefined;
  for (const [, name, value] of tests) if (attributes[name!] !== value) return undefined;
  return (match[1] === ":root" ? 10 : 1) + tests.length * 10;
}

// Custom properties on <html>, last-declaration-wins within a specificity.
export function cascadeVars(sheets: string[], env: Environment): Record<string, string> {
  const winning = new Map<string, { value: string; specificity: number }>();
  for (const sheet of sheets) {
    for (const rule of parseRules(sheet)) {
      const matched = rule.selectors.map((selector) => specificity(selector, env)).filter((s): s is number => s !== undefined);
      if (matched.length === 0) continue;
      const weight = Math.max(...matched);
      for (const [name, value] of rule.declarations) {
        if (!name.startsWith("--")) continue;
        const current = winning.get(name);
        if (!current || weight >= current.specificity) winning.set(name, { value, specificity: weight });
      }
    }
  }
  const vars = Object.fromEntries([...winning].map(([name, { value }]) => [name, value]));
  return { ...vars, ...env.hostVars };
}

function toHex(channels: number[]): string {
  return `#${channels.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

// Index of the ")" closing the "(" at `open`.
function closingParen(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    if (text[index] === "(") depth++;
    else if (text[index] === ")" && --depth === 0) return index;
  }
  throw new Error(`Unbalanced parenthesis in: ${text}`);
}

function topLevelCommas(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "(") depth++;
    else if (text[index] === ")") depth--;
    else if (text[index] === "," && depth === 0) {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts;
}

// Rewrites light-dark(a, b) to the branch the document theme selects and
// rgb()/rgba() to #hex (or, below full opacity, a mix with transparent), the
// forms resolveCssColor reads. Anything else is left as it is.
export function normalizeColorFunctions(value: string, theme: Theme): string {
  const pattern = /(light-dark|rgba|rgb)\(/;
  let match = pattern.exec(value);
  while (match) {
    const open = match.index + match[1]!.length;
    const close = closingParen(value, open);
    const args = topLevelCommas(value.slice(open + 1, close));
    let replacement: string;
    if (match[1] === "light-dark") {
      replacement = normalizeColorFunctions(args[theme === "light" ? 0 : 1]!, theme);
    } else {
      const channels = args.slice(0, 3).map(Number);
      const alpha = args[3] === undefined ? 1 : Number(args[3]);
      replacement = alpha >= 1 ? toHex(channels) : `color-mix(in srgb, ${toHex(channels)} ${+(alpha * 100).toFixed(2)}%, transparent)`;
    }
    value = value.slice(0, match.index) + replacement + value.slice(close + 1);
    match = pattern.exec(value);
  }
  return value;
}

// The colour `value` paints as on <html>, over `backdrop` where it is partly
// transparent. Declared values may themselves use light-dark() and rgba().
export function resolveColor(value: string, vars: Record<string, string>, theme: Theme, backdrop?: Rgb): Rgb {
  const normalized = Object.fromEntries(Object.entries(vars).map(([name, declared]) => [name, normalizeColorFunctions(declared, theme)]));
  return resolveCssColor(normalizeColorFunctions(value, theme), { vars: normalized, ...(backdrop ? { backdrop } : {}) });
}
