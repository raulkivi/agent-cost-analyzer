// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { claudeRow, row, savingsOutput, simulatedRow, span, twoCurrencyOutput, unpriced, upTo } from "./savings-fixtures.js";
import { toSavingsViewModel } from "./savings.js";

const rowOf = (vm: ReturnType<typeof toSavingsViewModel>, key: string) => [...vm.groups.flatMap((group) => group.rows), ...vm.simulated.rows].find((r) => r.key === key)!;

describe("toSavingsViewModel", () => {
  it("states the period, the basis and that amounts are not added up", () => {
    const vm = toSavingsViewModel(savingsOutput());
    expect(vm.periodText).toBe("Oct 15 – Nov 13, 30 days");
    expect(vm.basisText).toBe("amounts per week · prices as of use");
    expect(vm.notes.join(" ")).toMatch(/ranked by the high end/i);
    expect(vm.notes.join(" ")).toMatch(/not added up/);
    expect(vm.notes.join(" ")).toMatch(/cannot be billed/);
  });

  it("says prices today when the report is repriced", () => {
    expect(toSavingsViewModel(savingsOutput({ pricing: "today" })).basisText).toBe("amounts per week · prices today");
  });

  it("keeps the ranked order and labels an upper bound 'up to' and a range with both ends", () => {
    const vm = toSavingsViewModel(savingsOutput());
    const [credits] = vm.groups;
    expect(credits!.rows.map((r) => r.key)).toEqual(["idle:sonnet", "unused:github", "failed:git"]);
    expect(rowOf(vm, "idle:sonnet").amountText).toBe("up to 46.0 AI Credits per week");
    expect(rowOf(vm, "unused:github").amountText).toBe("6.2–38.4 AI Credits per week");
    expect(rowOf(vm, "idle:sonnet").windowText).toBe("Over the 30 days: up to 197.8 AI Credits. No lower bound is claimed.");
  });

  it("writes a known saving below the display precision as 'under', never 0.0–0.0", () => {
    const tiny = row({ key: "tiny", kind: "unused-tools", subject: "create_file", perWeek: span(0.001, 0.02), perWindow: span(0.004, 0.09) });
    const bound = row({ key: "bound", kind: "idle-cache-expiry", subject: "gpt-5.5", perWeek: upTo(0.01), perWindow: upTo(0.04) });
    const vm = toSavingsViewModel(savingsOutput({ opportunities: [tiny, bound], opportunitiesTotal: 2 }));
    expect(rowOf(vm, "tiny").amountText).toBe("under 0.1 AI Credits per week");
    expect(rowOf(vm, "tiny").windowText).toBe("Over the 30 days: 0.0–0.1 AI Credits.");
    expect(rowOf(vm, "bound").amountText).toBe("under 0.1 AI Credits per week");
    expect(rowOf(vm, "bound").windowText).toBe("Over the 30 days: under 0.1 AI Credits. No lower bound is claimed.");
  });

  it("never shows an unknown amount as 0: Not priced, with the reason and no bar, unranked", () => {
    const unknown = rowOf(toSavingsViewModel(savingsOutput()), "failed:git");
    expect(unknown.amountText).toBe("Not priced");
    expect(unknown.unknownReason).toBe(unpriced.known ? "" : unpriced.reason);
    expect(unknown.bar).toBeUndefined();
    expect(unknown.rank).toBeUndefined();
    expect(unknown.amountText).not.toMatch(/\b0(\.0)?\b/);
  });

  it("counts priced changes and not priced rows in the group subtitle, with provider names", () => {
    const [credits] = toSavingsViewModel(savingsOutput()).groups;
    expect(credits!.title).toBe("AI Credits");
    expect(credits!.subtitle).toBe("GitHub Copilot · 2 changes, 1 not priced");
  });

  it("makes one list per currency and never converts", () => {
    const vm = toSavingsViewModel(twoCurrencyOutput());
    expect(vm.groups.map((g) => g.title)).toEqual(["AI Credits", "US dollars"]);
    expect(rowOf(vm, "idle:opus").amountText).toBe("up to $3.20 per week");
    expect(vm.groups[1]!.subtitle).toBe("Claude Code · 1 change");
  });

  it("scales bars against the group's largest high end: solid to the low end, hatched to the high end", () => {
    const vm = toSavingsViewModel(savingsOutput());
    expect(rowOf(vm, "idle:sonnet").bar).toEqual({ solid: 0, hatched: 100 });
    expect(rowOf(vm, "unused:github").bar!.solid).toBeCloseTo((6.2 / 46) * 100);
  });

  it("labels inferred and estimate rows", () => {
    const vm = toSavingsViewModel(savingsOutput());
    expect(rowOf(vm, "unused:github")).toMatchObject({ inferred: true, estimate: true, simulated: false });
    expect(rowOf(vm, "idle:sonnet")).toMatchObject({ inferred: false, estimate: false });
  });

  it("writes coverage as analysed of in-window sessions with the reasons", () => {
    expect(rowOf(toSavingsViewModel(savingsOutput()), "idle:sonnet").coverageText).toBe("38 of 41 sessions · 3 had no request trace");
  });

  it("lists up to three sessions by id with Open cost, and keeps the total", () => {
    const r = rowOf(toSavingsViewModel(savingsOutput()), "idle:sonnet");
    expect(r.sessions.map((s) => [s.sessionId, s.kind, s.label])).toEqual([
      ["4b81d0aa", "cost", "Open cost"],
      ["c07e91d4", "cost", "Open cost"],
      ["e5a3190b", "cost", "Open cost"],
    ]);
    expect(r.sessionsHeading).toBe("Largest 3 of 11 sessions, over the 30 days");
    const many = toSavingsViewModel(savingsOutput({ opportunities: [row({ key: "k", kind: "idle-cache-expiry", subject: "m", sessions: ["a", "b", "c", "d", "e"].map((sessionId) => ({ providerId: "vscode", sessionId })) })], opportunitiesTotal: 1 }));
    expect(rowOf(many, "k").sessions).toHaveLength(3);
  });

  it("heads a list that is not cut by its count, not as the largest", () => {
    const one = toSavingsViewModel(savingsOutput({ opportunities: [claudeRow], opportunitiesTotal: 1 }));
    expect(rowOf(one, "idle:opus").sessionsHeading).toBe("1 session, over the 30 days");
  });

  it("carries the fixed action text, the evidence and the price versions", () => {
    const vm = toSavingsViewModel(savingsOutput());
    const r = rowOf(vm, "idle:sonnet");
    expect(r.action).toMatch(/^11 breaks after an idle gap/);
    expect(r.evidence).toEqual(expect.arrayContaining([{ label: "Breaks", value: "11" }, { label: "Tokens resent", value: "412,000" }]));
    expect(r.priceVersions).toEqual(["github-copilot@2026-10-01"]);
    expect(rowOf(vm, "unused:github").evidence).toEqual(expect.arrayContaining([{ label: "Tokens per request", value: "5,400 (estimate)" }]));
  });

  it("shows unknown evidence as Unknown", () => {
    const unknownEvidence = row({ key: "k", kind: "failed-tool-calls", subject: "rg", evidence: { sessions: 2, requests: null, tokens: { known: false, reason: "no token count in the log" }, occurrences: null } });
    const r = rowOf(toSavingsViewModel(savingsOutput({ opportunities: [unknownEvidence], opportunitiesTotal: 1 })), "k");
    expect(r.evidence).toEqual(expect.arrayContaining([{ label: "Requests", value: "Unknown" }, { label: "Tokens", value: "Unknown (no token count in the log)" }, { label: "Failed calls", value: "Unknown" }]));
  });

  describe("Simulated section (D17)", () => {
    it("says to ask in the chat when includeSimulated is off, with no control", () => {
      const vm = toSavingsViewModel(savingsOutput());
      expect(vm.simulated.rows).toEqual([]);
      expect(vm.simulated.text).toBe('Simulated replays are off. A replay of each of the most expensive sessions is the slow part, so it runs only when asked. To include it, ask in the chat, for example "show my savings including simulated replays".');
    });

    it("lists simulated rows unranked with Open replay on the simulated model", () => {
      const vm = toSavingsViewModel(savingsOutput({ includeSimulated: true, simulated: [simulatedRow], simulatedTotal: 1 }));
      expect(vm.simulated.text).toBeUndefined();
      const r = vm.simulated.rows[0]!;
      expect(r).toMatchObject({ simulated: true, amountText: "24.9–27.4 AI Credits per week", kindTitle: "A cheaper model" });
      expect(r.rank).toBeUndefined();
      expect(r.sessions.map((s) => [s.sessionId, s.kind, s.label, s.model])).toEqual([
        ["9d02e4c1", "replay", "Open replay", "claude-haiku-5.5"],
        ["e61a77f3", "replay", "Open replay", "claude-haiku-5.5"],
        ["0b7c35d8", "replay", "Open replay", "claude-haiku-5.5"],
      ]);
      expect(r.coverageText).toBe("5 of 5 sessions replayed · replayed 218 of 224 requests");
      expect(r.simulation).toEqual({ selfCheck: "passed, 97% of requests", replayed: "218 of 224 requests", assumptions: [{ id: "A1", text: expect.stringContaining("same conversation") }] });
    });

    it("says nothing was found when it is on and empty", () => {
      expect(toSavingsViewModel(savingsOutput({ includeSimulated: true })).simulated.text).toBe("No cheaper-model replay found in this window.");
    });
  });

  describe("truncation (D18)", () => {
    it("says how many of how many, text only", () => {
      expect(toSavingsViewModel(twoCurrencyOutput()).truncationText).toBe("Showing the 3 highest of 9 changes. Ask in the chat for more, up to 20.");
    });
    it("says nothing when every change is shown", () => {
      expect(toSavingsViewModel(savingsOutput()).truncationText).toBeUndefined();
    });
  });

  it("lists what was not analysed with kind, provider, reason and sessions", () => {
    const vm = toSavingsViewModel(savingsOutput({ notAnalysed: [{ kind: "unused-tools", providerId: "claude-code", reason: "the logs hold no tool inventory", sessions: 14 }, { kind: "idle-cache-expiry", providerId: "vscode", reason: "no request trace", sessions: 1 }] }));
    expect(vm.notAnalysed).toEqual([
      { kindTitle: "Tools loaded but never used", providerLabel: "Claude Code", reason: "the logs hold no tool inventory", sessionsText: "14 sessions" },
      { kindTitle: "Cache lost after an idle gap", providerLabel: "GitHub Copilot", reason: "no request trace", sessionsText: "1 session" },
    ]);
  });

  it("is empty-aware and lists sessions left out of the report", () => {
    const empty = toSavingsViewModel(savingsOutput({ opportunities: [], opportunitiesTotal: 0, notAnalysed: [] }));
    expect(empty.empty).toBe("No savings found in this window.");
    expect(empty.groups).toEqual([]);
    const left = toSavingsViewModel(savingsOutput({ sessionsLeftOut: [{ providerId: "vscode", reason: "over the session cap", sessions: 12 }] }));
    expect(left.leftOut).toEqual([{ providerLabel: "GitHub Copilot", reason: "over the session cap", sessionsText: "12 sessions" }]);
  });

  it("falls back to the provider id for an unknown provider", () => {
    const vm = toSavingsViewModel(savingsOutput({ opportunities: [row({ key: "k", kind: "idle-cache-expiry", subject: "m", sessions: [{ providerId: "newtool", sessionId: "s1" }] })], opportunitiesTotal: 1 }));
    expect(vm.groups[0]!.subtitle).toBe("newtool · 1 change");
  });

  it("offers no Open replay when the model id is not a plain id", () => {
    const hostile = { ...simulatedRow, simulation: { ...simulatedRow.simulation!, model: "x y<script>" } };
    const vm = toSavingsViewModel(savingsOutput({ includeSimulated: true, simulated: [hostile], simulatedTotal: 1 }));
    expect(vm.simulated.rows[0]!.sessions.every((s) => s.kind === "cost" && s.model === undefined)).toBe(true);
  });
});
