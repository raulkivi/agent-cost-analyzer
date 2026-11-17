// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { makeReplay } from "../test-support/replay-fixture.js";
import {
  coverageSentence,
  currencyLabel,
  formatReplayAmount,
  formatReplayDifference,
  pricedAtSentence,
  replayCostTitle,
  selfCheckSentence,
  splitAssumption,
  helperRequestsCostSentence,
  subagentRunsCostSentence,
} from "./replay-format.js";

describe("replay formatting (step 14.7)", () => {
  it("formats amounts in the replay's currency, and an unknown as 'unknown', never 0", () => {
    expect(formatReplayAmount(4.82, "USD")).toBe("$4.82");
    expect(formatReplayAmount(9.651, "AI_CREDITS")).toBe("9.65");
    expect(formatReplayAmount(null, "USD")).toBe("unknown");
    expect(currencyLabel("AI_CREDITS")).toBe("AI Credits");
    expect(currencyLabel("USD")).toBe("USD");
  });

  it("gives AI Credits a USD equivalent on hover, as elsewhere, and USD none", () => {
    expect(replayCostTitle({ known: true, value: 0.29, currency: "AI_CREDITS" })).toBe("≈ $0.0029");
    expect(replayCostTitle({ known: true, value: 0.29, currency: "USD" })).toBeUndefined();
    expect(replayCostTitle({ known: false, reason: "No price on 2026-09-14" })).toBe("Unknown: No price on 2026-09-14");
  });

  it("signs the difference and gives its share of the measured total", () => {
    expect(formatReplayDifference(-1.91, 4.82, "USD")).toEqual({ amount: "−$1.91", percent: "−39.6%" });
    expect(formatReplayDifference(2.04, 9.65, "AI_CREDITS")).toEqual({ amount: "+2.04", percent: "+21.1%" });
    expect(formatReplayDifference(0, 1, "USD")).toEqual({ amount: "$0.00", percent: "0.0%" });
    expect(formatReplayDifference(null, 4.82, "USD")).toEqual({ amount: "unknown", percent: undefined });
    expect(formatReplayDifference(1, 0, "USD").percent).toBeUndefined();
  });

  it("says how much of the session was replayed, with the reasons", () => {
    const replay = makeReplay();
    expect(coverageSentence(replay.coverage)).toBe("2 of 3 turns replayed; 1 not replayed: A request in this turn has no complete usage figures");
    expect(coverageSentence({ ...replay.coverage, replayedTurns: 3, notReplayed: [] })).toBe("3 of 3 turns replayed");
    expect(
      coverageSentence({ ...replay.coverage, replayedTurns: 0, notReplayed: [{ reason: "a", turns: 1 }, { reason: "b", turns: 2 }] }),
    ).toBe("0 of 3 turns replayed; 3 not replayed, for 2 reasons");
  });

  it("lists the subagent runs the replay leaves out, and says nothing for none", () => {
    const replay = makeReplay();
    const withRuns = (runs: number, costAiCredits = { known: true as const, value: 42.5 }) => ({ ...replay.coverage, subagentRuns: { runs, costAiCredits } });
    expect(coverageSentence(withRuns(2))).toBe(
      "2 of 3 turns replayed; 1 not replayed: A request in this turn has no complete usage figures; 2 subagent runs not replayed: replay covers the main agent only",
    );
    expect(coverageSentence(withRuns(1))).toContain("; 1 subagent run not replayed: replay covers the main agent only");
    expect(coverageSentence(withRuns(0))).toBe(coverageSentence(replay.coverage));
    expect(coverageSentence(replay.coverage)).not.toContain("subagent");
  });

  // Owner decision 2026-11-14 (analyze-session-replay.md §13, finding 1).
  it("lists the helper agents' requests the replay leaves out, and says nothing for none", () => {
    const replay = makeReplay();
    const withHelpers = (requests: number) => ({ ...replay.coverage, helperRequests: { requests, costAiCredits: { known: true as const, value: 0.25 } } });
    expect(coverageSentence(withHelpers(3))).toContain("; 3 helper-agent requests not replayed: each has a prompt of its own (todo list, conversation summary)");
    expect(coverageSentence(withHelpers(1))).toContain("; 1 helper-agent request not replayed: each has a prompt of its own (todo list, conversation summary)");
    expect(coverageSentence(replay.coverage)).not.toContain("helper");
  });

  it("words the helper requests' cost as kept in the measured figures, unknown when it is", () => {
    expect(helperRequestsCostSentence({ requests: 3, costAiCredits: { known: true, value: 0.25 } })).toBe("Their cost, 0.25 AI Credits, stays in the measured figures.");
    expect(helperRequestsCostSentence({ requests: 1, costAiCredits: { known: false, reason: "not recorded" } })).toBe("Their cost is unknown: not recorded");
    expect(helperRequestsCostSentence(undefined)).toBeUndefined();
  });

  it("words the cost of the runs left out, unknown when it is", () => {
    expect(subagentRunsCostSentence({ runs: 2, costAiCredits: { known: true, value: 42.5 } })).toBe("Their cost is 42.50 AI Credits.");
    expect(subagentRunsCostSentence({ runs: 2, costAiCredits: { known: false, reason: "a run log is missing" } })).toBe("Their cost is unknown: a run log is missing");
    expect(subagentRunsCostSentence(undefined)).toBeUndefined();
    expect(subagentRunsCostSentence({ runs: 0, costAiCredits: { known: true, value: 0 } })).toBeUndefined();
  });

  describe("runs without AI Credits (Claude Code): the priced cost and tokens", () => {
    const unknownCredits = { known: false as const, reason: "AI Credits are Copilot's own billing unit: a Claude Code CLI session has no AI Credits conversion." };
    const known = (n: number) => ({ known: true as const, value: n });
    const tokens = { uncachedInput: known(1_000), cacheWrite: known(2_000), cacheRead: known(30_000_000), output: known(1_400_000) };
    const figure = (amount: number) => ({ known: true as const, amount, currency: "USD" as const, basis: "priced" as const });
    const cost = (priced: ReturnType<typeof figure> | { known: false; reason: string }) => ({ billed: { known: false as const, reason: "no billing" }, reported: { known: false as const, reason: "none" }, priced });

    it("words the priced cost and tokens when the AI Credits are unknown", () => {
      const runs = { runs: 2, costAiCredits: unknownCredits, tokens, cost: cost(figure(9.2)) };
      expect(subagentRunsCostSentence(runs)).toBe("Their priced cost is $9.20 for 31.4M tokens.");
    });

    it("keeps the AI Credits sentence when they are known, even beside a priced cost", () => {
      const runs = { runs: 2, costAiCredits: known(42.5), tokens, cost: cost(figure(9.2)) };
      expect(subagentRunsCostSentence(runs)).toBe("Their cost is 42.50 AI Credits.");
    });

    it("says the priced cost is unknown with its reason, never 0", () => {
      const runs = { runs: 1, costAiCredits: unknownCredits, tokens, cost: cost({ known: false, reason: "no price for the model" }) };
      const sentence = subagentRunsCostSentence(runs);
      expect(sentence).toBe("Their priced cost is unknown: no price for the model");
      expect(sentence).not.toContain("$0");
    });

    it("keeps an unknown token count's reason beside a known priced cost", () => {
      const runs = { runs: 1, costAiCredits: unknownCredits, tokens: { ...tokens, output: { known: false as const, reason: "a run log is missing" } }, cost: cost(figure(0.5)) };
      expect(subagentRunsCostSentence(runs)).toBe("Their priced cost is $0.50; their tokens are unknown: a run log is missing");
    });

    it("words a priced cost without a token count", () => {
      expect(subagentRunsCostSentence({ runs: 1, costAiCredits: unknownCredits, cost: cost(figure(0.5)) })).toBe("Their priced cost is $0.50.");
    });

    it("falls back to the unknown AI Credits when no priced cost came", () => {
      expect(subagentRunsCostSentence({ runs: 1, costAiCredits: unknownCredits })).toBe(`Their cost is unknown: ${unknownCredits.reason}`);
    });
  });

  it("words the self-check both ways, and never rounds a failure up to 100%", () => {
    const passed = { model: "claude-opus-5.5", models: ["claude-opus-5.5"], requests: 40, matching: 40, readTolerancePercent: 5, passed: true };
    expect(selfCheckSentence(passed)).toBe("Replay matches the log on claude-opus-5.5: 100% of compared requests");
    expect(selfCheckSentence({ ...passed, matching: 37, passed: false })).toBe("Replay matches the log on claude-opus-5.5: 93% of compared requests");
    expect(selfCheckSentence({ ...passed, requests: 1000, matching: 999, passed: false })).toBe("Replay matches the log on claude-opus-5.5: 99% of compared requests");
    expect(selfCheckSentence({ ...passed, requests: 0, matching: 0 })).toBe("Replay matches the log on claude-opus-5.5: no request to compare (the first is a cold start)");
    expect(selfCheckSentence({ ...passed, model: "claude-sonnet-5.5", models: ["claude-sonnet-5.5", "claude-opus-5.5"] })).toBe("Replay matches the log on claude-sonnet-5.5, then claude-opus-5.5: 100% of compared requests");
    expect(selfCheckSentence(null)).toMatch(/^No self-check for this session/);
  });

  it("names the prices and their date, or why nothing is priced", () => {
    expect(pricedAtSentence(makeReplay().pricing, "Anthropic")).toBe("Priced at the Anthropic API's prices as of 2026-10-21");
    expect(pricedAtSentence({ channel: "copilot", asOf: "2026-10-21", requested: "copilot" }, "Anthropic")).toBe("Priced at GitHub Copilot's prices as of 2026-10-21");
    expect(pricedAtSentence({ channel: null, reason: "No price channel is known, so nothing simulated is priced: the log records none.", asOf: "2026-10-21", requested: "session-channel" }, "OpenAI")).toBe(
      "Not priced: No price channel is known, so nothing simulated is priced: the log records none.",
    );
  });

  it("splits an assumption into its title and text at the first colon", () => {
    expect(splitAssumption("Same conversation: the other model gets the same prompts.")).toEqual({ title: "Same conversation", text: "the other model gets the same prompts." });
    expect(splitAssumption("No colon here")).toEqual({ title: undefined, text: "No colon here" });
  });
});
