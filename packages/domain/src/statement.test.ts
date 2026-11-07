// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { diffStatements, parseStatementPeriod, periodHasEnded, statementSchema } from "./statement.js";
import { sampleStatement } from "./test-support/statement-sample.js";

// Phase 15 step 15.11 (plan §8.5, D4, D6, D13–D15): a billing statement for
// one project and period, its diff against a frozen copy, and the period
// rules (calendar months in the statement's time zone; only ended periods
// can be issued).

describe("statementSchema", () => {
  it("accepts a draft with lines, unknown lines, markup, fixed lines, totals per currency, a user currency and provenance", () => {
    expect(statementSchema.parse(sampleStatement())).toEqual(sampleStatement());
  });

  it("needs issuedAt exactly when issued", () => {
    expect(() => statementSchema.parse(sampleStatement({ status: "issued" }))).toThrow(/issuedAt/);
    expect(statementSchema.parse(sampleStatement({ status: "issued", issuedAt: "2026-11-06T12:00:00.000Z" })).status).toBe("issued");
    expect(() => statementSchema.parse(sampleStatement({ issuedAt: "2026-11-06T12:00:00.000Z" }))).toThrow(/issuedAt/);
  });

  it("refuses a total that isn't its lines, markup and fixed lines", () => {
    const totals = [{ currency: "AI_CREDITS" as const, lines: 120, markup: 12, fixed: 0, total: 130 }];
    expect(() => statementSchema.parse(sampleStatement({ totals }))).toThrow(/total/);
  });
});

describe("parseStatementPeriod", () => {
  it("reads a month as the calendar month in the time zone", () => {
    expect(parseStatementPeriod("2026-02", "Europe/Tallinn")).toEqual({ key: "2026-02", label: "February 2026", since: "2026-02-01", until: "2026-02-28", timeZone: "Europe/Tallinn" });
  });

  it("reads an inclusive range", () => {
    expect(parseStatementPeriod("2026-10-01..2026-10-15", "UTC")).toEqual({ key: "2026-10-01_2026-10-15", label: "Oct 1 – Oct 15, 2026", since: "2026-10-01", until: "2026-10-15", timeZone: "UTC" });
  });

  it("refuses anything else, a reversed range and an unknown time zone", () => {
    expect(parseStatementPeriod("October", "UTC")).toBeNull();
    expect(parseStatementPeriod("2026-13", "UTC")).toBeNull();
    expect(parseStatementPeriod("2026-10-15..2026-10-01", "UTC")).toBeNull();
    expect(parseStatementPeriod("2026-10", "Mars/Olympus")).toBeNull();
  });
});

describe("periodHasEnded (D15)", () => {
  const october = parseStatementPeriod("2026-10", "Europe/Tallinn")!;

  it("is false until the last day has passed in the statement's time zone", () => {
    // 2026-10-31T21:59Z is still Oct 31 in Tallinn (UTC+2 after the DST change).
    expect(periodHasEnded(october, new Date("2026-10-31T21:59:00Z"))).toBe(false);
    expect(periodHasEnded(october, new Date("2026-10-31T22:00:00Z"))).toBe(true);
  });
});

describe("diffStatements", () => {
  const issued = sampleStatement({ status: "issued", issuedAt: "2026-11-02T09:00:00.000Z" });

  it("finds nothing when a re-run gives the same figures and sessions", () => {
    expect(diffStatements(issued, sampleStatement()).changed).toBe(false);
  });

  it("gives the exact difference per line, per currency total and in the sessions and inputs", () => {
    const line = { ...sampleStatement().lines[0]!, amount: 150, turns: 6 };
    const added = { ...line, key: "priced|USD|anthropic-api|claude-sonnet-5.5|v2", basis: "priced" as const, currency: "USD" as const, amount: 2.5, priceVersionId: "v2" };
    const current = sampleStatement({
      lines: [line, added],
      markup: [
        { currency: "AI_CREDITS", base: 150, amount: 15 },
        { currency: "USD", base: 2.5, amount: 0.25 },
      ],
      totals: [
        { currency: "AI_CREDITS", lines: 150, markup: 15, fixed: 0, total: 165 },
        { currency: "USD", lines: 2.5, markup: 0.25, fixed: 39, total: 41.75 },
      ],
      provenance: { ...issued.provenance, priceBookHash: "pb2", sessions: [...issued.provenance.sessions, { providerId: "pi-agent", sessionId: "p1", title: "Late log" }] },
    });
    const diff = diffStatements(issued, current);
    expect(diff.changed).toBe(true);
    expect(diff.lines).toEqual([
      { key: line.key, change: "changed", issued: 120, current: 150, difference: 30 },
      { key: added.key, change: "added", issued: null, current: 2.5, difference: 2.5 },
    ]);
    expect(diff.totals).toEqual([
      { currency: "AI_CREDITS", issued: 132, current: 165, difference: 33 },
      { currency: "USD", issued: 39, current: 41.75, difference: 2.75 },
    ]);
    expect(diff.sessions).toEqual({ added: ["pi-agent:p1"], removed: [] });
    expect(diff.inputs).toEqual({ priceBookChanged: true, projectsFileChanged: false });
  });
});

describe("statementAnswerSchema (GET /api/statements, MCP get_statement)", () => {
  it("holds the draft and whether it can be issued, or the frozen copy with the re-run's diff", async () => {
    const { statementAnswerSchema } = await import("./statement.js");
    const draft = sampleStatement();
    expect(statementAnswerSchema.parse({ statement: draft, canIssue: { ok: false, reason: "October 2026 hasn't ended yet in Europe/Tallinn." }, issuedPeriods: [] }).canIssue.ok).toBe(false);
    const issued = sampleStatement({ status: "issued", issuedAt: "2026-11-02T09:00:00.000Z" });
    const answer = statementAnswerSchema.parse({ statement: issued, rerun: draft, diff: diffStatements(issued, draft), canIssue: { ok: false, reason: "Already issued." }, issuedPeriods: ["2026-10"] });
    expect(answer.diff?.changed).toBe(false);
  });
});

describe("insight turn rows carry their time (step 15.11, D6)", () => {
  it("accepts the turn's ISO time as at", async () => {
    const { insightTurnRowSchema } = await import("./insights.js");
    const row = {
      key: "p:s:0",
      sessionKey: "p:s",
      turnIndex: 0,
      model: "m",
      uncachedInput: null,
      cacheWrite: null,
      cacheRead: null,
      reasoning: null,
      output: null,
      aiCredits: null,
      estimated: false,
      toolCallCount: null,
      repositoryKey: "github.com/a/b",
      projectId: null,
      vendorId: null,
      vendorUnknownReason: "unknown",
      channel: null,
      channelUnknownReason: "unknown",
      date: "2026-10-31",
      at: "2026-10-31T22:30:00.000Z",
    };
    expect(insightTurnRowSchema.parse(row).at).toBe("2026-10-31T22:30:00.000Z");
  });
});
