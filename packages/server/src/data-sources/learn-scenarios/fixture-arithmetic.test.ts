import { describe, expect, it } from "vitest";
import type { TokenCount } from "@agent-cost-analyzer/domain";
import { listLearnScenarios } from "./loader.js";

// Each turn's AI Credits must equal its token counts priced at the
// illustrative per-1K-token rates its scenario doc states
// (docs/scenarios/*.md). Guards against the hand-computed slips found by
// docs/learn-scenarios-fact-check.md (F-01..F-05).
interface Rates {
  uncached: number; // uncached input, tool and vision tokens
  cacheWrite: number;
  cacheRead: number;
  output: number; // output and reasoning tokens
}

const BASE: Rates = {
  uncached: 0.005,
  cacheWrite: 0.00625,
  cacheRead: 0.0005,
  output: 0.015,
};
// Model B in scenarios 4 and 14 (docs/scenarios/04-model-switch.md).
const MODEL_B: Rates = {
  uncached: 0.01,
  cacheWrite: 0.01,
  cacheRead: 0.001,
  output: 0.03,
};

const RATES_BY_MODEL: Record<string, Rates> = {
  "example-model": BASE,
  "model-a": BASE,
  "model-b": MODEL_B,
};

// Scenario 13 prices its 1-hour cache writes at 2x the 5-minute write rate.
// The fact-check (R-02) found Anthropic prices them at 2x *base input*
// (0.01 here); kept as the fixture's current rate until that re-model lands.
const RATE_OVERRIDES_BY_SCENARIO: Record<string, Partial<Rates>> = {
  "cache-ttl-1-hour-breakpoint": { cacheWrite: 0.0125 },
};

const value = (count: TokenCount | undefined): number =>
  count && count.known ? count.value : 0;

// Half-up rounding to 4 decimals, as the scenario docs round.
const round4 = (n: number): number => Math.round((n + 1e-9) * 10_000) / 10_000;

describe("learn scenario fixture arithmetic", () => {
  for (const scenario of listLearnScenarios()) {
    for (const turn of scenario.turns) {
      it(`${scenario.id} turn ${turn.index} cost matches its stated rates`, () => {
        const usage = turn.usage;
        const model = usage.model ?? scenario.model;
        const rates = {
          ...RATES_BY_MODEL[model],
          ...RATE_OVERRIDES_BY_SCENARIO[scenario.id],
        };
        expect(rates.uncached, `no rates for model ${model}`).toBeDefined();

        const expected =
          ((value(usage.uncachedInput) +
            value(usage.tool) +
            value(usage.vision)) *
            rates.uncached +
            value(usage.cacheWrite) * rates.cacheWrite +
            value(usage.cacheRead) * rates.cacheRead +
            (value(usage.reasoning) + value(usage.output)) * rates.output) /
          1000;

        expect(value(usage.costAiCredits)).toBe(round4(expected));
      });
    }
  }
});
