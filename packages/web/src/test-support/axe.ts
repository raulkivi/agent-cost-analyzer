import axe from "axe-core";

// Runs axe-core's WCAG 2.2 A/AA rules (vscode-extension.md §3.5
// Accessibility) over `context` and returns its violations, each with the
// offending nodes, so a failing expectation names what to fix.
//
// color-contrast is off: jsdom computes no colours or layout, so axe can't
// measure contrast here (it reports it as incomplete at best).
// theme-contrast.test.ts checks the theme's colour pairs instead.
export async function axeViolations(context: Element = document.body): Promise<string[]> {
  const results = await axe.run(context, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    rules: { "color-contrast": { enabled: false } },
    resultTypes: ["violations"],
  });
  return results.violations.flatMap((violation) =>
    violation.nodes.map((node) => `${violation.id}: ${violation.help} — ${node.target.join(" ")}`),
  );
}
