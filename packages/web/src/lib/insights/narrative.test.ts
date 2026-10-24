import { describe, expect, it } from "vitest";
import { sampleInsightsDataset } from "../../test-support/insights-fixture.js";
import { buildNarrative } from "./narrative.js";

const dataset = sampleInsightsDataset();

describe("buildNarrative", () => {
  it("says what happened, when, and what to look at", () => {
    expect(buildNarrative(dataset)).toEqual([
      "3 sessions across Claude Code and VS Code, 2026-10-09 → 2026-10-10.",
      "They used 5.50 AI Credits (3 of 4 turns with known usage); 80% of input tokens were served from cache.",
      "Agents made 3 tool calls; 50% of the 2 with a known outcome failed, mostly command not found (1).",
      "Signals to review: 1 critical. Most severe: “Downloaded script piped straight into an interpreter” on 2026-10-09 09:05 UTC in “Fix tests”.",
      "Behaviour changes: first use of program `npm` (2026-10-10).",
    ]);
  });

  it("doesn't name providers for a single-provider product (crossProvider false, G10)", () => {
    const [first] = buildNarrative(dataset, { crossProvider: false });

    expect(first).toBe("3 sessions, 2026-10-09 → 2026-10-10.");
  });

  it("states plainly when usage is unknown, nothing failed and nothing was flagged", () => {
    const turns = dataset.turns.map((turn) => ({ ...turn, aiCredits: null, cacheRead: null }));
    const toolCalls = dataset.toolCalls.map((call) => ({ ...call, status: "success" as const, failureCategory: undefined }));
    expect(buildNarrative({ ...dataset, turns, toolCalls, findings: [] })).toEqual([
      "3 sessions across Claude Code and VS Code, 2026-10-09 → 2026-10-10.",
      "AI Credits are unknown for all 4 turns (the log source did not record usage).",
      "Agents made 3 tool calls; none of the 3 with a known outcome failed.",
      "No security signals.",
    ]);
  });

  it("reads naturally for a single unknown turn", () => {
    const [first] = dataset.turns;
    const lines = buildNarrative({ ...dataset, turns: [{ ...first!, aiCredits: null }] });
    expect(lines).toContain("AI Credits are unknown for the only turn (the log source did not record usage).");
  });

  it("handles an empty selection", () => {
    expect(buildNarrative({ ...dataset, sessions: [], turns: [], toolCalls: [], findings: [] })).toEqual([
      "No sessions match the current selections.",
    ]);
  });
});
