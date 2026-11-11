// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { RunLogEntry } from "../../../../scripts/release-evidence/build.mts";
import { budgetCheck, creditsSpent, DEFAULT_MAX_AI_CREDITS, MAX_AI_CREDITS_ENV, parseMaxAiCredits } from "./credit-budget.mts";

describe("parseMaxAiCredits (COPILOT_E2E_MAX_AI_CREDITS)", () => {
  it("defaults to 3 AI Credits per run (D12, proposed)", () => {
    expect(MAX_AI_CREDITS_ENV).toBe("COPILOT_E2E_MAX_AI_CREDITS");
    expect(DEFAULT_MAX_AI_CREDITS).toBe(3);
    expect(parseMaxAiCredits(undefined)).toEqual({ ok: true, max: 3 });
    expect(parseMaxAiCredits("  ")).toEqual({ ok: true, max: 3 });
  });

  it("takes a decimal number of AI Credits", () => {
    expect(parseMaxAiCredits("2")).toEqual({ ok: true, max: 2 });
    expect(parseMaxAiCredits(" 1.5 ")).toEqual({ ok: true, max: 1.5 });
  });

  it("takes 0: a run that sends no chat at all", () => {
    expect(parseMaxAiCredits("0")).toEqual({ ok: true, max: 0 });
  });

  it("refuses anything else, naming the variable, rather than run without a cap", () => {
    for (const value of ["-1", "abc", "2x", "Infinity", "NaN"]) {
      expect(parseMaxAiCredits(value)).toEqual({ ok: false, reason: expect.stringContaining("COPILOT_E2E_MAX_AI_CREDITS") });
    }
  });
});

describe("creditsSpent (what the run log says the run's chats cost)", () => {
  it("sums every chat's credits, across spec files", () => {
    const log: RunLogEntry[] = [
      { kind: "credits", spent: 0.25 },
      { kind: "observed-model", model: "claude-haiku-5.5" },
      { kind: "credits", spent: 0.5 },
      { kind: "skip", scope: "test", title: "t", reason: "r" },
    ];

    expect(creditsSpent(log)).toBeCloseTo(0.75);
  });

  it("is 0 before any chat", () => {
    expect(creditsSpent([])).toBe(0);
  });
});

describe("budgetCheck (checked before every chat)", () => {
  it("lets a chat through while the run has spent less than the cap", () => {
    expect(budgetCheck([{ kind: "credits", spent: 1.2 }], 3)).toEqual({ send: true, spent: 1.2 });
  });

  it("refuses once the run has spent the cap, with 'budget exceeded' and both figures", () => {
    const decision = budgetCheck(
      [
        { kind: "credits", spent: 2.5 },
        { kind: "credits", spent: 0.75 },
      ],
      3,
    );

    expect(decision.send).toBe(false);
    expect(decision).toMatchObject({ reason: expect.stringContaining("budget exceeded") });
    expect(decision).toMatchObject({ reason: expect.stringContaining("3.2500") });
    expect(decision).toMatchObject({ reason: expect.stringContaining("COPILOT_E2E_MAX_AI_CREDITS=3") });
  });

  it("refuses at exactly the cap: the next chat would go over it", () => {
    expect(budgetCheck([{ kind: "credits", spent: 2 }], 2).send).toBe(false);
  });

  it("with a cap of 0 refuses every chat, so a run can check launches for free", () => {
    expect(budgetCheck([], 0).send).toBe(false);
  });
});
