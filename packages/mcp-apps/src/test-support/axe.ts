// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import axe from "axe-core";

// Runs axe-core's WCAG 2.2 A/AA rules and its best practices over `context`
// and returns one line per offending node, so a failing expectation names
// what to fix (the same helper as packages/web's). Test-only: nothing
// outside the tests imports it, so axe stays out of dist/views.html.
//
// color-contrast is off: jsdom computes no colours or layout, so axe can't
// measure it. test/theme/theme-contrast.test.ts (A6) checks the theme's
// colour pairs against the fallbacks and every recorded host variable set
// instead.
export async function axeViolations(context: Element = document.body): Promise<string[]> {
  const results = await axe.run(context, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
    rules: { "color-contrast": { enabled: false } },
    resultTypes: ["violations"],
  });
  return results.violations.flatMap((violation) => violation.nodes.map((node) => `${violation.id}: ${violation.help} — ${node.target.join(" ")}`));
}
