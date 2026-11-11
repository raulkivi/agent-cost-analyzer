// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { issuedAnswerWithDiff, statement, statementAnswer } from "./increment3-fixtures.js";
import { toStatementViewModel } from "./statement.js";

describe("toStatementViewModel", () => {
  it("names the project, period and status", () => {
    const vm = toStatementViewModel(statementAnswer());
    expect(vm).toMatchObject({ title: "Customer portal", periodText: "October 2026", status: "draft", statusText: "Draft", client: "ACME", billingCode: "AC-7" });
    expect(vm.diff).toBeUndefined();
  });

  it("lists lines by basis, currency, channel and model, AI Credits before USD", () => {
    const { lines } = toStatementViewModel(statementAnswer());
    expect(lines.map((line) => [line.currency, line.model])).toEqual([["AI_CREDITS", "gpt-5.5"], ["AI_CREDITS", "o4"], ["USD", "claude-sonnet-5.5"]]);
    expect(lines[0]).toMatchObject({ basisText: "billed", channelText: "github-copilot", amountText: "120.00 AI Credits", turnsText: "5 turns", sessionsText: "2 sessions", apiEquivalent: false });
    expect(lines[2]).toMatchObject({ basisText: "priced", amountText: "$4.50" });
  });

  it("reads Unknown for a token count that is null, never 0", () => {
    const { lines } = toStatementViewModel(statementAnswer());
    expect(lines[0]!.tokens.reasoning).toMatchObject({ text: "Unknown", known: false });
    expect(lines[0]!.tokens.cacheRead).toMatchObject({ text: "3 k", known: true });
    expect(lines[1]!.tokens.output.text).toBe("Unknown");
    expect(lines[1]!.channelText).toBe("no channel");
  });

  it("shows totals per currency, AI Credits first, with markup and fixed lines", () => {
    const { totals } = toStatementViewModel(statementAnswer());
    expect(totals.map((total) => total.currency)).toEqual(["AI_CREDITS", "USD"]);
    expect(totals[0]).toMatchObject({ linesText: "150.00 AI Credits", markupText: "15.00 AI Credits", fixedText: "0.00 AI Credits", totalText: "165.00 AI Credits" });
    expect(totals[1]).toMatchObject({ totalText: "$43.50", fixedText: "$39.00" });
  });

  it("states coverage, with a note when partial", () => {
    expect(toStatementViewModel(statementAnswer()).coverage).toEqual({ text: "known for 9 of 10 turns", partial: true });
    const full = toStatementViewModel(statementAnswer({ statement: statement({ coverage: { turns: 10, knownTurns: 10 } }) }));
    expect(full.coverage).toEqual({ text: "all 10 turns known", partial: false });
  });

  it("counts unknown turns with their reason, never as 0, and excluded turns apart", () => {
    const vm = toStatementViewModel(statementAnswer());
    expect(vm.unknown).toEqual([{ reason: "No cost figure in the log", turnsText: "1 turn", sessionsText: "1 session", amountText: "Unknown" }]);
    expect(vm.excluded).toEqual([{ reason: "Subscription use (API-equivalent)", turnsText: "2 turns", sessionsText: "1 session" }]);
  });

  it("shows the fixed lines and the conversion note", () => {
    const vm = toStatementViewModel(statementAnswer());
    expect(vm.fixedLines).toEqual([{ label: "Seats", amountText: "$39.00", currency: "USD" }]);
    expect(vm.conversionNote).toContain("1 AI Credit = $0.01");
  });

  it("says whether it can be issued, and why not", () => {
    expect(toStatementViewModel(statementAnswer()).canIssue).toEqual({ ok: true });
    expect(toStatementViewModel(statementAnswer({ canIssue: { ok: false, reason: "Costs are unknown" } })).canIssue).toEqual({ ok: false, reason: "Costs are unknown" });
  });

  it("lists the issued periods", () => {
    expect(toStatementViewModel(statementAnswer()).issuedPeriods).toEqual(["2026-09"]);
  });

  describe("an issued period's diff", () => {
    const vm = toStatementViewModel(issuedAnswerWithDiff());

    it("is shown for an issued statement, with its status and issue date", () => {
      expect(vm).toMatchObject({ status: "issued", statusText: "Issued Nov 2" });
      expect(vm.diff).toMatchObject({ changed: true });
    });

    it("shows each line change, never 'from 0' for an added line", () => {
      const lines = vm.diff!.lines;
      expect(lines.map((line) => line.change)).toEqual(["changed", "added", "removed"]);
      expect(lines[0]).toMatchObject({ labelText: "billed, github-copilot, gpt-5.5", issuedText: "120.00 AI Credits", currentText: "128.00 AI Credits", differenceText: "+8.00 AI Credits" });
      expect(lines[1]).toMatchObject({ issuedText: "no earlier figure", currentText: "$1.25", differenceText: "+$1.25" });
      expect(lines[2]).toMatchObject({ issuedText: "30.00 AI Credits", currentText: "not in the re-run", differenceText: "−30.00 AI Credits" });
    });

    it("shows totals per currency, AI Credits first", () => {
      expect(vm.diff!.totals.map((total) => total.currency)).toEqual(["AI_CREDITS", "USD"]);
      expect(vm.diff!.totals[0]).toMatchObject({ issuedText: "165.00 AI Credits", currentText: "150.80 AI Credits", differenceText: "−14.20 AI Credits" });
    });

    it("says what moved: unknown turns, sessions and inputs", () => {
      expect(vm.diff!.unknownTurnsText).toBe("unknown turns 1 → 2");
      expect(vm.diff!.sessionsText).toBe("1 session added, none removed");
      expect(vm.diff!.inputsText).toEqual(["the price book changed"]);
    });
  });
});
