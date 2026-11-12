// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { sessionCost } from "../../view-models/fixtures.js";
import { subagentRun, turnViewWithRuns } from "../../view-models/turn-view-fixture.js";
import { parseSessionCost, parseTurnView } from "./tool-data.js";

// Step 10.19: the optional subagent fields pass through the parsers whole.
describe("parsers keep the subagent fields", () => {
  it("parseTurnView keeps usage.subagents and usage.ownUsage", () => {
    const parsed = parseTurnView(turnViewWithRuns([subagentRun()]));
    expect(parsed?.usage.subagents).toHaveLength(1);
    expect(parsed?.usage.ownUsage?.costAiCredits).toEqual({ known: true, value: 4.25 });
  });

  it("parseSessionCost keeps subagents { runs, aiCredits, unavailableReason }", () => {
    const withRuns = { ...sessionCost(), subagents: { runs: 2, aiCredits: null, unavailableReason: "a log is missing" } };
    expect(parseSessionCost(withRuns)?.subagents).toEqual({ runs: 2, aiCredits: null, unavailableReason: "a log is missing" });
  });
});
