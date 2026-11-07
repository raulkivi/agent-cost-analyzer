// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { createRequire } from "node:module";
import type { Page } from "@playwright/test";

// Plan §12.4.1: the axe check at every stop of a scenario, in a real
// browser, so colour contrast is measured too (jsdom can't). WCAG 2.2 A/AA,
// as the component suite's test-support/axe.ts.
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

export async function axeViolations(page: Page): Promise<string[]> {
  await page.addScriptTag({ path: axePath });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (context: Document, options: object) => Promise<{ violations: { id: string; help: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const results = await axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
      resultTypes: ["violations"],
    });
    return results.violations.flatMap((violation) => violation.nodes.map((node) => `${violation.id}: ${violation.help} — ${node.target.join(" ")}`));
  });
}
