// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Step 13.8's manual check ("pick 3 vendors on scenario 15 and confirm the
// outcomes match the rule register"), driven in a real VS Code. The expected
// outcomes come from docs/learn-rule-register.md, not from the simulator:
//  - Anthropic documents that adding or removing an image invalidates the
//    message cache, so the two image turns are partial hits.
//  - OpenAI, Google and xAI document no such rule, so those turns must read
//    "unknown", never a guessed hit or miss.
// What a person still judges by eye: that the wording and layout read well.
import { browser, expect } from "@wdio/globals";
import { AnalyzerPanel } from "../support/analyzer-panel.js";
import { wdioVscodeHost as host } from "../support/vscode-host.js";

const panel = new AnalyzerPanel(host);

const SCENARIO_15_ID = "image-attachment-invalidation";
const HIT = "Cache hit";
const MISS = "Cache miss";
const PARTIAL = "Cache partial hit";
const UNKNOWN = "Cache outcome unknown";

// Turn 1 writes the cache, turn 2 reads it; turns 3 and 5 attach an image.
const EXPECTED: { vendor: string; modelId: string; outcomes: string[] }[] = [
  { vendor: "Anthropic", modelId: "claude-sonnet-5.5", outcomes: [MISS, HIT, PARTIAL, HIT, PARTIAL] },
  { vendor: "OpenAI", modelId: "gpt-6.1-sol", outcomes: [MISS, HIT, UNKNOWN, HIT, UNKNOWN] },
  { vendor: "xAI", modelId: "grok-4.7", outcomes: [MISS, HIT, UNKNOWN, HIT, UNKNOWN] },
];

suite("Learn vendors (check 13.8)", () => {
  suiteSetup(async () => {
    await host.waitForExtension();
    await panel.reset();
  });

  test("13.8 scenario 15 on three vendors gives the outcomes the rule register documents", async () => {
    await panel.openScenario(SCENARIO_15_ID);

    await panel.inside(async (view) => {
      await view.waitForTurnRows(5);
      for (const { vendor, modelId, outcomes } of EXPECTED) {
        await view.chooseSimulationModel(modelId);
        await browser.waitUntil(
          async () => JSON.stringify(await view.cacheOutcomes()) === JSON.stringify(outcomes),
          {
            timeout: 30_000,
            timeoutMsg: `${vendor} (${modelId}): the Cache column did not show ${outcomes.join(", ")}`,
          },
        );
        // Every turn names the model it was simulated on.
        expect(await view.hasText(modelId)).toBe(true);
      }
    });
  });
});
