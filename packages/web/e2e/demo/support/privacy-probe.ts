// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { homedir, userInfo } from "node:os";
import type { Page } from "@playwright/test";
import { findForbidden, forbiddenTerms } from "../../../../vscode-extension/scripts/demo/privacy-probe.mts";
import type { DemoScene } from "./demo-driver.js";

// What no web demo frame may show: the owner-private terms (home directory, user name,
// DEMO_FORBIDDEN) and the word "fixture" in any case (D36: no "fixture-…" model name, no
// "Fixture session" title). The probe matches substrings without regard to case.
export function sceneForbiddenTerms(demoForbidden: string | undefined, os: { homedir: string; username: string }): string[] {
  return [...forbiddenTerms(demoForbidden, os), "fixture"];
}

export async function assertPrivate(page: Page): Promise<void> {
  const text = await page.evaluate(() => document.body.innerText);
  const terms = sceneForbiddenTerms(process.env.DEMO_FORBIDDEN, { homedir: homedir(), username: userInfo().username });
  const hits = findForbidden([{ source: "app page", text: `${text}\n${page.url()}` }], terms);
  if (hits.length > 0) throw new Error(`Forbidden text on screen: ${hits.map((hit) => `${hit.match} in ${hit.source}`).join(", ")}`);
}

// The scene with the probe run after every step.
export const probed = (scene: DemoScene): DemoScene => ({
  ...scene,
  steps: scene.steps.map((step) => ({
    ...step,
    action: async (page, pointer) => {
      await step.action(page, pointer);
      await assertPrivate(page);
    },
  })),
});
