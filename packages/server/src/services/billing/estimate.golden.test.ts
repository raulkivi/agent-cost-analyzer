// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { costEstimateSchema } from "@agent-cost-analyzer/domain";
import { composeCostFixture } from "../../test-support/cost-analysis-fixture.js";

// Phase 15 step 15.12 exit criterion (plan §14): forecasts over the fixture
// dataset (three providers, two projects, the bundled price book at today's
// prices), committed under __golden__/ (update with `vitest -u` after
// checking the diff by hand).

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

describe("estimates over the fixture dataset (golden)", () => {
  const { api } = composeCostFixture();

  it("portal and billing, by active day and by session, over 12 and 4 weeks", async () => {
    const answers = {
      portalDays12: await api.getCostEstimate({ projectId: "portal", activeDays: "20" }),
      portalSessions4: await api.getCostEstimate({ projectId: "portal", sessions: "10", historyWeeks: "4" }),
      billingDays12: await api.getCostEstimate({ projectId: "billing", activeDays: "20" }),
      repository: await api.getCostEstimate({ repository: "github.com/acme/portal-web", activeDays: "5" }),
    };
    for (const answer of Object.values(answers)) {
      const estimate = costEstimateSchema.parse(answer);
      // Never a single number: a range with both ends, or none and the reason.
      expect(estimate.range === null ? estimate.refusal : estimate.range.p90 >= estimate.range.p50).toBeTruthy();
    }
    await expect(json(answers)).toMatchFileSnapshot("./__golden__/estimates.json");
  });
});
