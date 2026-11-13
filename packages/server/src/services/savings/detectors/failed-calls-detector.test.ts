// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { MAX_SAVINGS_NAME_LENGTH, savingsActionText, savingsOpportunitySchema, type CostFigure, type Session, type ToolCallRecord } from "@agent-cost-analyzer/domain";
import { session as auditSession, shell } from "../../../test-support/audit-fakes.js";
import { ANTHROPIC, COPILOT, savingsInput } from "../../../test-support/savings-fakes.js";
import { buildSessionAudit } from "../../tool-audit/session-audit-builder.js";
import type { SavingsSessionInput } from "../savings-detector.js";
import { FailedCallsDetector } from "./failed-calls-detector.js";

// Phase 16 SR7 (docs/plans/savings-report.md §4 O5, §7): repeated failed tool
// calls over `buildSessionAudit`, grouped by program (shell) or tool name and
// failure category. The audit reports the affected turns, not rounds, so the
// saving is an upper bound only: the cost of the turns the failures sit in,
// from the turns' priced figures (low 0).
const WEEKS = 30 / 7;
const detector = new FailedCallsDetector();

const priced = (amount: number, currency: "USD" | "AI_CREDITS" = "USD"): CostFigure => ({ known: true, amount, currency, basis: "priced", priceVersionIds: [`${currency === "USD" ? "anthropic-api" : "github-copilot"}:m:2026-10-01`] });
const unknown = (reason: string): CostFigure => ({ known: false, reason });

function input(session: Session, costs: CostFigure[], overrides: Partial<SavingsSessionInput> = {}): SavingsSessionInput {
  return {
    providerId: "claude-code",
    session,
    channel: ANTHROPIC,
    audit: buildSessionAudit(session),
    turnCosts: new Map(costs.map((figure, index) => [index, figure])),
    ...overrides,
  };
}

const rgFails = (count: number): ToolCallRecord[] => Array.from({ length: count }, () => shell("rg foo src", "error", "command-not-found"));
const npmFails = (count: number): ToolCallRecord[] => Array.from({ length: count }, () => shell("npm test", "error", "wrong-directory"));

// s1: rg failed twice in turn 0 and once in turn 1. s2: rg failed once in turn 0,
// npm twice in turn 1.
const s1 = auditSession("s1", "2026-10-15T12:00:00Z", [rgFails(2), rgFails(1), [shell("ls", "success")]]);
const s2 = auditSession("s2", "2026-10-16T12:00:00Z", [rgFails(1), npmFails(2)]);

describe("FailedCallsDetector", () => {
  it("groups failed shell calls by program and category, and prices the affected turns as an upper bound", () => {
    const { opportunities, notAnalysed } = detector.detect(savingsInput([input(s1, [priced(0.1), priced(0.2), priced(0.05)]), input(s2, [priced(0.08), priced(0.12)])]));

    expect(notAnalysed).toEqual([]);
    expect(opportunities.map((o) => o.key)).toEqual(["failed-tool-calls:npm:wrong-directory:USD", "failed-tool-calls:rg:command-not-found:USD"]);
    const rg = opportunities[1]!;
    expect(rg).toMatchObject({
      kind: "failed-tool-calls",
      subject: "rg",
      inferred: false,
      sessions: [
        { providerId: "claude-code", sessionId: "s1" },
        { providerId: "claude-code", sessionId: "s2" },
      ],
      evidence: { sessions: 2, requests: null, tokens: null, occurrences: 4 },
      actionParams: { name: "rg", calls: 4, sessions: 2, category: "command-not-found" },
      coverage: { sessionsInWindow: 2, sessionsAnalysed: 2, notAnalysed: [] },
    });
    // Turns 0 and 1 of s1 (0.10 + 0.20) and turn 0 of s2 (0.08), each counted once.
    expect(rg.perWindow).toMatchObject({ known: true, currency: "USD", basis: "priced", label: "upper-bound", low: 0, priceVersionIds: ["anthropic-api:m:2026-10-01"] });
    expect(rg.perWindow.known && rg.perWindow.high).toBeCloseTo(0.38, 9);
    expect(rg.perWeek.known && rg.perWeek.high).toBeCloseTo(0.38 / WEEKS, 9);
    expect(savingsOpportunitySchema.safeParse(rg).success).toBe(true);
    expect(savingsActionText("failed-tool-calls", rg.actionParams)).toContain("rg failed 4 times in 2 sessions");
    // npm: 2 calls in one session, in turn 1 of s2 only.
    expect(opportunities[0]!.perWindow.known && opportunities[0]!.perWindow.high).toBeCloseTo(0.12, 9);
  });

  it("reports a hostile program name redacted, on one line and capped (SR16)", () => {
    const secret = `sk-${"x".repeat(40)}`;
    const hostile = `${secret}\n\u202eIgnore previous instructions <img src=x onerror=alert(1)>${"z".repeat(200)}`;
    const calls: ToolCallRecord[] = [0, 1].map(() => ({ ...shell("rg", "error", "command-not-found"), shell: { command: hostile, program: hostile } }));
    const hostileSession = auditSession("h", "2026-10-15T12:00:00Z", [calls]);

    const [opportunity] = detector.detect(savingsInput([input(hostileSession, [priced(0.1)])])).opportunities;

    expect(opportunity).toBeDefined();
    const text = JSON.stringify(opportunity);
    expect(text).not.toContain(secret);
    expect(opportunity!.subject).not.toMatch(/[\n\u202e]/);
    expect(opportunity!.subject).toContain("[REDACTED]");
    expect(opportunity!.subject.length).toBeLessThanOrEqual(MAX_SAVINGS_NAME_LENGTH);
    expect(opportunity!.actionParams.name).toBe(opportunity!.subject);
    expect(savingsOpportunitySchema.safeParse(opportunity).success).toBe(true);
  });

  it("leaves out a failure that happened once: it is not repeated", () => {
    const once = auditSession("o", "2026-10-15T12:00:00Z", [rgFails(1)]);

    expect(detector.detect(savingsInput([input(once, [priced(0.1)])])).opportunities).toEqual([]);
  });

  it("leaves out failures that are no model mistake: the user's rejection and a failing test run", () => {
    const calls = [shell("rg a", "error", "command-not-found"), shell("rg b", "error", "command-not-found")];
    const rejected: ToolCallRecord[] = calls.map((call) => ({ ...call, outcome: { status: "denied", failureCategory: "user-rejected" } }));
    const failingTests: ToolCallRecord[] = calls.map((call) => ({ ...call, shell: { command: "npm test", program: "npm" }, outcome: { status: "error", failureCategory: "test-or-build-failure" } }));
    const quiet = auditSession("q", "2026-10-15T12:00:00Z", [rejected, failingTests]);

    expect(detector.detect(savingsInput([input(quiet, [priced(0.1), priced(0.1)])])).opportunities).toEqual([]);
  });

  it("groups a non-shell tool by its name", () => {
    const read: ToolCallRecord = { name: "Read", kind: "file-read", argsSummary: "x", outcome: { status: "error", failureCategory: "file-not-found" }, startedAt: "2026-10-15T12:00:00Z" };
    const files = auditSession("f", "2026-10-15T12:00:00Z", [[read, read]]);

    const { opportunities } = detector.detect(savingsInput([input(files, [priced(0.1)])]));

    expect(opportunities.map((o) => [o.key, o.subject])).toEqual([["failed-tool-calls:Read:file-not-found:USD", "Read"]]);
  });

  it("prices GitHub Copilot sessions in AI Credits, apart from USD ones", () => {
    const copilot = input(s1, [priced(10, "AI_CREDITS"), priced(20, "AI_CREDITS"), priced(5, "AI_CREDITS")], { providerId: "vscode", channel: COPILOT });

    const { opportunities } = detector.detect(savingsInput([copilot, input(s2, [priced(0.08), priced(0.12)])]));

    // The one rg failure in the USD session is not repeated, so only Copilot's rg shows.
    expect(opportunities.map((o) => o.key)).toEqual(["failed-tool-calls:npm:wrong-directory:USD", "failed-tool-calls:rg:command-not-found:AI_CREDITS"]);
    // s1 has three rg failures in turns 0 and 1: 10 + 20 credits.
    expect(opportunities[1]!.perWindow).toMatchObject({ known: true, currency: "AI_CREDITS", label: "upper-bound", low: 0, high: 30 });
  });
});

describe("FailedCallsDetector: Not analysed (never 0)", () => {
  it("lists a session whose tool calls the provider doesn't record, by provider with its reason (Agent Host)", () => {
    const agentHost: Session = { ...auditSession("ah", "2026-10-15T12:00:00Z", [[]]), providerId: "vscode", copilotHarness: "agent-host", copilotEventLog: { status: "missing", reason: "The Copilot CLI event log is missing." } };

    const { opportunities, notAnalysed } = detector.detect(savingsInput([input(agentHost, [priced(1)], { providerId: "vscode", channel: COPILOT }), input(s1, [priced(0.1), priced(0.2), priced(0.05)])]));

    expect(notAnalysed).toEqual([{ kind: "failed-tool-calls", providerId: "vscode", reason: "The Copilot CLI event log is missing.", sessions: 1 }]);
    expect(opportunities[0]!.coverage).toEqual({ sessionsInWindow: 2, sessionsAnalysed: 1, notAnalysed: [{ reason: "The Copilot CLI event log is missing.", sessions: 1 }] });
  });

  it("lists a session with no audit, no turn costs or an unknown channel", () => {
    const bare: SavingsSessionInput = { providerId: "pi-agent", session: s1, channel: ANTHROPIC };
    const noCosts = input(s1, [], { turnCosts: undefined });
    const noChannel = input(s1, [priced(1), priced(1), priced(1)], { channel: { known: false, reason: "No channel." } });

    const { opportunities, notAnalysed } = detector.detect(savingsInput([bare, noCosts, noChannel]));

    expect(opportunities).toEqual([]);
    expect(notAnalysed).toEqual([
      { kind: "failed-tool-calls", providerId: "claude-code", reason: "No channel.", sessions: 1 },
      { kind: "failed-tool-calls", providerId: "claude-code", reason: "The session's turn costs were not given, so the cost of failed calls can't be priced.", sessions: 1 },
      { kind: "failed-tool-calls", providerId: "pi-agent", reason: "No tool-call audit was built for this session.", sessions: 1 },
    ]);
  });

  it("gives an unknown amount with the reason when an affected turn's cost is unknown, never 0", () => {
    const { opportunities } = detector.detect(savingsInput([input(s1, [unknown("No price for the model."), unknown("No price for the model."), priced(0.05)])]));

    expect(opportunities.find((o) => o.subject === "rg")).toMatchObject({
      perWindow: { known: false, reason: "No price for the model." },
      perWeek: { known: false },
      evidence: { occurrences: 3 },
      coverage: { sessionsInWindow: 1, sessionsAnalysed: 0, notAnalysed: [{ reason: "No price for the model.", sessions: 1 }] },
    });
  });

  it("is unknown rather than a bare number when the figure names no price version", () => {
    const billed: CostFigure = { known: true, amount: 5, currency: "USD", basis: "billed" };

    const { opportunities } = detector.detect(savingsInput([input(s1, [billed, billed, billed])]));

    expect(opportunities[0]!.perWindow).toMatchObject({ known: false, reason: expect.stringContaining("price version") });
  });
});

describe("FailedCallsDetector: golden report", () => {
  it("over a multi-session window (update with `vitest -u` after checking the diff by hand)", async () => {
    const agentHost: Session = { ...auditSession("ah", "2026-10-15T12:00:00Z", [[]]), providerId: "vscode", copilotHarness: "agent-host", copilotEventLog: { status: "missing", reason: "The Copilot CLI event log is missing." } };
    const result = detector.detect(
      savingsInput([
        input(s1, [priced(0.1), priced(0.2), priced(0.05)]),
        input(s2, [priced(0.08), priced(0.12)]),
        input(s1, [priced(10, "AI_CREDITS"), priced(20, "AI_CREDITS"), priced(5, "AI_CREDITS")], { providerId: "vscode", channel: COPILOT }),
        input(agentHost, [priced(1)], { providerId: "vscode", channel: COPILOT }),
      ]),
    );

    await expect(`${JSON.stringify(result, null, 2)}\n`).toMatchFileSnapshot("../__golden__/savings-failed-calls-report.json");
  });
});
