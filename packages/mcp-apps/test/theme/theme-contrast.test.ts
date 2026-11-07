// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// @vitest-environment node
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

describe("contrast: tightest margins (informational)", () => {
  it("lists the closest pairs", () => {
    const rows = ALL_SETS.flatMap((set) => checksFor(set).map((check) => ({ set: set.name, ...check, margin: check.ratio / check.minimum })));
    rows.sort((a, b) => a.margin - b.margin);
    for (const row of rows.slice(0, 8)) console.info(`${row.ratio.toFixed(2)}:1 (min ${row.minimum}) ${row.set}: ${row.label}`);
    expect(rows.length).toBeGreaterThan(0);
  });
});
