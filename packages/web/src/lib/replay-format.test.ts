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
