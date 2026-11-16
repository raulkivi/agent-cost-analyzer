// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { unavailableTokenCount } from "@agent-cost-analyzer/domain";
import { describe, expect, it } from "vitest";
import { foldRuns as folded, known, mainUsage as own, subagentRun as run } from "../../test-support/subagent-usage-fakes.js";
import { turnLinesOf, UNREAD_RUNS_MODEL } from "./turn-cost-lines.js";

// Step 10.19 (classic subagents plan §4.5): a turn that ran subagents splits
// into one usage per part: the main agent's own, then each run's, on its
// own model, so each part is priced and billed on the model that used it.

describe("turnLinesOf", () => {
  it("has no lines for a turn that ran no subagent", () => {
    expect(turnLinesOf(own())).toBeUndefined();
  });

  it("splits a turn into the main agent's own usage and each run's, on its own model", () => {
    const lines = turnLinesOf(folded(own(), [run(), run({ id: "toolu_run2", label: "searchSubagent", model: "claude-haiku-5", costAiCredits: known(0) })]))!;
    expect(lines.map((line) => [line.usage.model, line.subagent, line.usage.costAiCredits])).toEqual([
      ["claude-sonnet-5.5", false, known(1.5)],
      ["gpt-6.1-sol", true, known(0.25)],
      ["claude-haiku-5", true, known(0)],
    ]);
    // The main agent's line keeps its own figures and request count, not the folded total.
    expect(lines[0]!.usage).toMatchObject({ uncachedInput: known(1000), cacheRead: known(5000), output: known(400), roundsCount: 3 });
    expect(lines[0]!.usage.subagents).toBeUndefined();
    // A run's line has the run's figures and its own request count (the pricer's tier rule reads it).
    expect(lines[1]!.usage).toMatchObject({ uncachedInput: known(100), cacheWrite: known(20), cacheRead: known(900), reasoning: known(5), output: known(60), roundsCount: 7 });
  });

  it("keeps a run's unknown figure unknown with its reason, and the main agent's line known (D10)", () => {
    const lines = turnLinesOf(folded(own(), [run({ costAiCredits: unavailableTokenCount("nested subagents are not read") })]))!;
    expect(lines[0]!.usage.costAiCredits).toEqual(known(1.5));
    expect(lines[1]!.usage.costAiCredits).toEqual({ known: false, reason: "nested subagents are not read" });
  });

  it("adds an unknown line for runs the reader could not read, so the lines never sum to a known figure the row doesn't have", () => {
    const usage = folded(own(), [run()], "The subagent log is missing.");
    expect(usage.costAiCredits.known).toBe(false);
    const lines = turnLinesOf(usage)!;
    expect(lines).toHaveLength(3);
    const unread = lines[2]!;
    expect(unread.subagent).toBe(true);
    expect(unread.usage.model).toBe(UNREAD_RUNS_MODEL);
    for (const field of ["uncachedInput", "cacheWrite", "cacheRead", "reasoning", "output", "costAiCredits"] as const) {
      expect(unread.usage[field]).toEqual({ known: false, reason: "The subagent log is missing." });
    }
  });

  it("adds an unread line also when the turn's runs list is empty", () => {
    const lines = turnLinesOf(folded(own(), [], "The subagent log is missing."))!;
    expect(lines.map((line) => line.usage.model)).toEqual(["claude-sonnet-5.5", UNREAD_RUNS_MODEL]);
  });

  it("adds no unread line when every unknown figure of the row is some line's own unknown", () => {
    const lines = turnLinesOf(folded(own({ cacheWrite: unavailableTokenCount("no agent traces") }), [run({ cacheWrite: unavailableTokenCount("no agent traces") })]))!;
    expect(lines).toHaveLength(2);
  });
});

// CS9: Claude Code lines. Each line carries its own 1-hour cache writes, so a
// run's 1-hour writes are priced at the 1-hour rate, not the 5-minute one.
describe("turnLinesOf, extendedCacheWrite (CS9)", () => {
  it("gives the own line its own extendedCacheWrite, not the folded total, and each run line its own", () => {
    const usage = folded(own({ extendedCacheWrite: known(150) }), [
      run({ extendedCacheWrite: known(15) }),
      run({ id: "toolu_run2", extendedCacheWrite: known(0) }),
    ]);

    const lines = turnLinesOf(usage)!;

    expect(usage.extendedCacheWrite).toEqual(known(165));
    expect(lines.map((line) => line.usage.extendedCacheWrite)).toEqual([known(150), known(15), known(0)]);
  });

  it("keeps Copilot lines without extendedCacheWrite", () => {
    const lines = turnLinesOf(folded(own(), [run()]))!;

    for (const line of lines) expect(line.usage).not.toHaveProperty("extendedCacheWrite");
  });

  it("gives an unknown extendedCacheWrite to a line that records none when the row has one", () => {
    const lines = turnLinesOf(folded(own({ extendedCacheWrite: known(150) }), [run()]))!;

    expect(lines[0]!.usage.extendedCacheWrite).toEqual(known(150));
    expect(lines[1]!.usage.extendedCacheWrite?.known).toBe(false);
  });

  it("gives the unread line the remainder of extendedCacheWrite, unknown with the reason", () => {
    const usage = folded(own({ extendedCacheWrite: known(150) }), [run({ extendedCacheWrite: known(15) })], "The subagent log is missing.");

    const unread = turnLinesOf(usage)![2]!;

    expect(unread.usage.extendedCacheWrite).toEqual({ known: false, reason: "The subagent log is missing." });
  });
});
