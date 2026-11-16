// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { enrichedFinding, findingsResult } from "../views/findings/fixtures.js";
import { toFindingsViewModel } from "./findings.js";

// Step 10.20, ST13: a finding from a subagent call names the run (§5.7).

const run = (overrides: Record<string, unknown> = {}) => ({ kind: "subagent" as const, runId: "run-1", label: "Agent-Explore", depth: 1, ...overrides });

describe("FindingRow.originText", () => {
  it("is absent for the main agent, with or without an origin", () => {
    const rows = toFindingsViewModel(findingsResult([enrichedFinding({ key: "a" }), enrichedFinding({ key: "b", origin: { kind: "main" } })]), {}).rows;
    expect(rows.map((row) => row.originText)).toEqual([undefined, undefined]);
  });

  it("names the run and the turn for a subagent call", () => {
    const [row] = toFindingsViewModel(findingsResult([enrichedFinding({ turnIndex: 4, origin: run() })]), {}).rows;
    expect(row!.originText).toBe("by subagent run Agent-Explore (turn 4)");
  });

  it("leaves out the turn when the finding has none, and adds depth for a nested run", () => {
    const [row] = toFindingsViewModel(findingsResult([enrichedFinding({ turnIndex: undefined, origin: run({ depth: 2, parentRunId: "run-0", label: "search_code_subagent" }) })]), {}).rows;
    expect(row!.originText).toBe("by subagent run search_code_subagent (depth 2)");
  });
});
