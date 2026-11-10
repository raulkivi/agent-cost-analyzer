// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contrastRatio, type Rgb } from "@agent-cost-analyzer/web/lib/contrast";
import { describe, expect, it } from "vitest";
import { cascadeVars, resolveColor } from "./css-vars.js";
import { CLAUDE_SETS, FALLBACK_SETS, SHEETS, VSCODE_SETS, type HostSet } from "./host-sets.js";

// Plan §5 / task A6: text at 4.5:1 or more and marks at 3:1 or more, in light
// and dark, against the fallbacks (a host that sends nothing), the recorded
// Claude set and the resolved VS Code set. The token values are read from the
// real stylesheets, so these guard theme-mcp-host.css and brand.css.
//
// The view is transparent, so it is drawn on the host's own ground: its page
// (background-primary) or the chat it sits in (secondary, tertiary); the
// fallbacks assume --brand-fb-ground. Cards and tiles use --color-surface.

const TEXT = 4.5;
const MARK = 3;

interface Check {
  label: string;
  ratio: number;
  minimum: number;
}

function checksFor(set: HostSet): Check[] {
  const vars = cascadeVars(SHEETS, { theme: set.theme, hostVars: set.hostVars });
  const colour = (value: string, backdrop?: Rgb) => resolveColor(value, vars, set.theme, backdrop);
  const hasHostGrounds = "--color-background-primary" in set.hostVars;
  const grounds = hasHostGrounds
    ? ["var(--color-background-primary)", "var(--color-background-secondary)", "var(--color-background-tertiary)"]
    : ["var(--brand-fb-ground)"];
  const backgrounds = [...grounds, "var(--color-surface)"];

  const checks: Check[] = [];
  for (const background of backgrounds) {
    const ground = colour(background);
    const on = (token: string, minimum: number) =>
      checks.push({ label: `${token} on ${background}`, ratio: contrastRatio(colour(`var(${token})`, ground), ground), minimum });
    on("--color-text", TEXT);
    on("--color-text-muted", TEXT);
    on("--color-accent-text", TEXT);
    on("--brand-mark", MARK);
    on("--color-accent", MARK);
    on("--color-accent-fill", MARK);
  }

  const pair = (foreground: string, background: string, minimum: number) => {
    const ground = colour(grounds[0]!);
    checks.push({
      label: `${foreground} on ${background}`,
      ratio: contrastRatio(colour(`var(${foreground})`, ground), colour(`var(${background})`, ground)),
      minimum,
    });
  };
  // Labels on filled controls and on the tinted tags.
  pair("--brand-on-accent", "--color-accent-fill", TEXT);
  pair("--color-accent-800", "--color-accent-100", TEXT);
  pair("--color-accent-2-800", "--color-accent-2-100", TEXT);
  pair("--color-neutral-800", "--color-neutral-100", TEXT);
  pair("--color-neutral-800", "--color-neutral-200", TEXT);
  return checks;
}

// U11's waterfall (A23): a rise in the host's danger colour, a fall in its
// success colour (owner decision 2026-11-10), the period totals in the
// brand's data colour. The bars and their key swatches are graphics, so they
// need 3:1 against every ground and the surface. theme.css's series 1 failed
// on Claude dark (2.99:1), and its diverging red and series-6 green on a dark
// host that sends nothing, so the dark fallbacks are brand.css's own. The
// fills are read from the stylesheet.
const COST_CHANGE_CSS = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/views/cost-change/cost-change.css"), "utf8");

function declared(css: string, selector: string, property: "fill" | "background"): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{\\s*${property}:\\s*([^;]+);`).exec(css);
  if (!match) throw new Error(`No ${property} for ${selector}`);
  return match[1]!.trim();
}
const fillOf = (css: string, selector: string) => declared(css, selector, "fill");

const WATERFALL_FILLS = {
  rise: fillOf(COST_CHANGE_CSS, ".cv-waterfall .waterfall-increase"),
  fall: fillOf(COST_CHANGE_CSS, ".cv-waterfall .waterfall-decrease"),
  "period total": fillOf(COST_CHANGE_CSS, ".cv-waterfall .waterfall-total"),
};

function waterfallChecksFor(set: HostSet): Check[] {
  const vars = cascadeVars(SHEETS, { theme: set.theme, hostVars: set.hostVars });
  const colour = (value: string, backdrop?: Rgb) => resolveColor(value, vars, set.theme, backdrop);
  const grounds = "--color-background-primary" in set.hostVars ? ["var(--color-background-primary)", "var(--color-background-secondary)", "var(--color-background-tertiary)"] : ["var(--brand-fb-ground)"];
  return [...grounds, "var(--color-surface)"].flatMap((background) => {
    const ground = colour(background);
    return Object.entries(WATERFALL_FILLS).map(([mark, fill]) => ({ label: `U11 ${mark} (${fill}) on ${background}`, ratio: contrastRatio(colour(fill, ground), ground), minimum: MARK }));
  });
}

const ALL_SETS = [...FALLBACK_SETS, ...CLAUDE_SETS, ...VSCODE_SETS];

describe.each(ALL_SETS)("contrast: $name", (set) => {
  const checks = checksFor(set);

  it("covers the text and mark pairs it is meant to", () => {
    // Six tokens on every ground plus the surface, then five fill/tag pairs.
    const grounds = "--color-background-primary" in set.hostVars ? 3 : 1;
    expect(checks).toHaveLength(6 * (grounds + 1) + 5);
  });

  it.each(checks.map((check) => [check.label, check] as const))("%s", (_label, check) => {
    expect(check.ratio, `${check.ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(check.minimum);
  });
});

describe("U11 waterfall fills", () => {
  it("are the host's danger and success colours with the brand's fallbacks, and the brand's data colour", () => {
    expect(WATERFALL_FILLS).toEqual({
      rise: "var(--color-text-danger, var(--brand-fb-danger))",
      fall: "var(--color-text-success, var(--brand-fb-success))",
      "period total": "var(--color-accent)",
    });
  });

  it("fall back to theme.css's diverging red and series-6 green on a light host that sends nothing", () => {
    const vars = cascadeVars(SHEETS, { theme: "light", hostVars: {} });
    expect(resolveColor("var(--brand-fb-danger)", vars, "light")).toEqual(resolveColor("var(--color-diverging-increase)", vars, "light"));
    expect(resolveColor("var(--brand-fb-success)", vars, "light")).toEqual(resolveColor("var(--color-series-6)", vars, "light"));
  });

  it("are what the key's swatches show", () => {
    expect(declared(COST_CHANGE_CSS, ".cv-swatch--increase", "background")).toBe(WATERFALL_FILLS.rise);
    expect(declared(COST_CHANGE_CSS, ".cv-swatch--decrease", "background")).toBe(WATERFALL_FILLS.fall);
    expect(declared(COST_CHANGE_CSS, ".cv-swatch--total", "background")).toBe(WATERFALL_FILLS["period total"]);
  });
});

describe.each(ALL_SETS)("contrast of U11's waterfall marks: $name", (set) => {
  it.each(waterfallChecksFor(set).map((check) => [check.label, check] as const))("%s", (_label, check) => {
    expect(check.ratio, `${check.ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(check.minimum);
  });
});

describe("contrast: tightest margins (informational)", () => {
  it("lists the closest pairs", () => {
    const rows = ALL_SETS.flatMap((set) => [...checksFor(set), ...waterfallChecksFor(set)].map((check) => ({ set: set.name, ...check, margin: check.ratio / check.minimum })));
    rows.sort((a, b) => a.margin - b.margin);
    for (const row of rows.slice(0, 8)) console.info(`${row.ratio.toFixed(2)}:1 (min ${row.minimum}) ${row.set}: ${row.label}`);
    expect(rows.length).toBeGreaterThan(0);
  });
});
