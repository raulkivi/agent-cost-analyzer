import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Session } from "@agent-cost-analyzer/domain";
import { loadScenarioScripts } from "../../data-sources/learn-scripts/loader.js";
import { loadVendorProfiles } from "../../data-sources/vendor-profiles/loader.js";
import { NoCheaperModelError, simulateScenario } from "./simulate-scenario.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const profiles = loadVendorProfiles(
  path.resolve(here, "../../../fixtures/vendor-profiles"),
);
const scripts = loadScenarioScripts();
// Moonshot and Microsoft are listed but not simulated (D1).
const SIMULATED = ["anthropic", "openai", "google", "xai"];

const fmt = (c: { known: boolean; value?: number }): string =>
  c.known ? String(c.value) : "n/a";

// One compact line per turn keeps snapshot diffs reviewable (13.5 exit).
function render(session: Session): string {
  return session.turns
    .map((t) => {
      const u = t.usage;
      const s = t.simulation!;
      const credits = u.costAiCredits.known
        ? u.costAiCredits.value.toFixed(4)
        : "n/a";
      return `${t.index} ${u.model} ${s.cacheOutcome}${s.invalidatedFrom ? `(${s.invalidatedFrom})` : ""} uncached=${fmt(u.uncachedInput)} write=${fmt(u.cacheWrite)} read=${fmt(u.cacheRead)} credits=${credits}`;
    })
    .join("\n");
}

describe("golden simulations (scenario × vendor default model)", () => {
  for (const script of scripts) {
    for (const vendorId of SIMULATED) {
      it(`${script.id} on ${vendorId}`, () => {
        const profile = profiles.find((p) => p.vendorId === vendorId)!;
        const options = {
          profile,
          modelId: profile.defaultModelId,
          harness: script.harnesses[0]!,
        };
        const sibling = profile.models.find(
          (m) => m.modelId === profile.defaultModelId,
        )?.cheaperSiblingId;
        try {
          expect(render(simulateScenario(script, options))).toMatchSnapshot();
        } catch (error) {
          if (!(error instanceof NoCheaperModelError)) throw error;
          expect(sibling).toBeUndefined();
        }
      });
    }
  }

  // Claude Code keeps its cache an hour, so a 5-minute break is a hit there
  // and the scripts carry a longer break for it (step 13.5a).
  describe("on the Claude Code harness (1-hour cache)", () => {
    for (const id of ["cache-ttl-smoke-break", "cascading-model-switch-then-ttl-lapse"]) {
      it(`${id}`, () => {
        const script = scripts.find((s) => s.id === id)!;
        const profile = profiles.find((p) => p.vendorId === "anthropic")!;
        const session = simulateScenario(script, {
          profile,
          modelId: profile.defaultModelId,
          harness: "claude-code",
        });
        expect(render(session)).toMatchSnapshot();
        // The break is the step with a long idle gap: it must be a miss.
        const lapse = id === "cache-ttl-smoke-break" ? 7 : 4;
        expect(session.turns[lapse]!.simulation?.cacheOutcome).toBe("miss");
      });
    }
  });
});
