// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import * as domain from "./index.js";
import { failureCategorySchema } from "./tool-call-outcome.js";
import { MAX_SAVINGS_NAME_LENGTH, savingsOpportunityKindSchema, type SavingsActionParams, type SavingsOpportunityKind } from "./savings.js";
import { SAVINGS_ACTION_PARAMS, savingsActionText } from "./savings-actions.js";

// Phase 16 SR9 (docs/plans/savings-report.md §5.2, §7, §11): action text is a
// fixed template in the second person. Parameters are numbers, model ids and
// capped names only, and no template says the app changed anything (read-only,
// vision §6). The wording is reviewed by the owner in SR11.
const SAMPLE: Record<SavingsOpportunityKind, SavingsActionParams> = {
  "unused-tools": { group: "github", tools: 12, tokens: 1200, sessions: 6, days: 30 },
  "idle-cache-expiry": { breaks: 4, minutes: 5, tokens: 80000 },
  "unexplained-cache-break": { breaks: 3, tokens: 52000 },
  "model-switch": { times: 2, tokens: 64000 },
  "failed-tool-calls": { name: "rg", calls: 14, sessions: 6, category: "command-not-found" },
  "cheaper-model": { model: "claude-haiku-5.5", percent: 40, matchPercent: 100 },
};

// Past-tense or first-person wording that would claim the app acted.
const CLAIMS_A_CHANGE = /\b(we|i|our|has been|have been|was|were|turned off|disabled|enabled|removed|updated|changed|applied|fixed|installed|edited|saved|written)\b/i;

describe("savingsActionText", () => {
  it.each(savingsOpportunityKindSchema.options)("has a template for %s that fills every parameter", (kind) => {
    const text = savingsActionText(kind, SAMPLE[kind]);

    expect(text.length).toBeGreaterThan(20);
    expect(text).not.toMatch(/[{}]|undefined|NaN/);
    for (const value of Object.values(SAMPLE[kind])) {
      if (kind === "failed-tool-calls" && value === "command-not-found") continue; // selects fixed advice, never echoed
      expect(text).toContain(String(value));
    }
  });

  it.each(savingsOpportunityKindSchema.options)("%s never claims a change was made", (kind) => {
    expect(savingsActionText(kind, SAMPLE[kind])).not.toMatch(CLAIMS_A_CHANGE);
  });

  it.each(failureCategorySchema.options)("failed-tool-calls advice for %s never claims a change", (category) => {
    const text = savingsActionText("failed-tool-calls", { ...SAMPLE["failed-tool-calls"], category });

    expect(text).not.toMatch(CLAIMS_A_CHANGE);
    expect(text).not.toContain(category);
  });

  it("declares every parameter of every template as a number, a model id or a name", () => {
    for (const kind of savingsOpportunityKindSchema.options) {
      for (const type of Object.values(SAVINGS_ACTION_PARAMS[kind])) {
        expect(["number", "modelId", "name"]).toContain(type);
      }
      expect(Object.keys(SAVINGS_ACTION_PARAMS[kind]).sort()).toEqual(Object.keys(SAMPLE[kind]).sort());
    }
  });

  it("names the 1-hour cache option only when its lifetime is given", () => {
    const base = savingsActionText("idle-cache-expiry", SAMPLE["idle-cache-expiry"]);
    const withOption = savingsActionText("idle-cache-expiry", { ...SAMPLE["idle-cache-expiry"], extendedMinutes: 60 });

    expect(base).not.toContain("1-hour");
    expect(withOption).toContain("1-hour");
    expect(withOption).toContain("higher");
  });

  it("is in the second person for the cheaper-model kind's simulated wording and keeps the A1 sentence", () => {
    const text = savingsActionText("cheaper-model", SAMPLE["cheaper-model"]);

    expect(text).toContain("Simulated");
    expect(text).toContain("would not have answered the same way");
  });

  it("folds a name to one line, removes control characters and caps its length", () => {
    const text = savingsActionText("unused-tools", { ...SAMPLE["unused-tools"], group: `evil\n\u0007server ${"x".repeat(500)}` });

    expect([...text].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)).toBe(false);
    const group = /Turn off the tools of (.*?) in the tool picker/.exec(text)?.[1] ?? "";
    expect(group.length).toBeLessThanOrEqual(MAX_SAVINGS_NAME_LENGTH);
    expect(group.startsWith("evil server")).toBe(true);
  });

  it("rejects a parameter that is not a number where a number is declared", () => {
    expect(() => savingsActionText("model-switch", { times: "two", tokens: 1 })).toThrow(/times/);
    expect(() => savingsActionText("model-switch", { times: Number.NaN, tokens: 1 })).toThrow(/times/);
    expect(() => savingsActionText("model-switch", { times: Infinity, tokens: 1 })).toThrow(/times/);
    expect(() => savingsActionText("model-switch", { times: -1, tokens: 1 })).toThrow(/times/);
  });

  it("rejects a model id that is not a plain id", () => {
    for (const model of ["gpt 5", "<b>x</b>", "a\nb", "", "x".repeat(200), "`rm -rf`"]) {
      expect(() => savingsActionText("cheaper-model", { ...SAMPLE["cheaper-model"], model }), model).toThrow(/model/);
    }
  });

  it("rejects a missing or an unknown parameter", () => {
    expect(() => savingsActionText("model-switch", { times: 2 })).toThrow(/tokens/);
    expect(() => savingsActionText("model-switch", { times: 2, tokens: 1, extra: "x" })).toThrow(/extra/);
  });

  it("exports the function from the domain index", () => {
    expect(domain.savingsActionText).toBe(savingsActionText);
  });
});
