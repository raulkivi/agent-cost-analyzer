// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { parseStatementPeriod, statementSchema, type CostFigure, type Project } from "@agent-cost-analyzer/domain";
import { billed, costs, cubeOf, cubeRow, reported, unknownFigure } from "../../test-support/cost-cube-fakes.js";
import { buildStatement, type StatementInputs } from "./statement-builder.js";

// Phase 15 step 15.11 (plan §8.5, D4, D6, D13, D14): one project's statement
// for one period, a pure function over the cost cube. Each turn counts at
// its preferred basis; unknown cost is listed, never 0; subscription use is
// left off unless the project opts in; markup and fixed lines come from the
// project; months are calendar months in the statement's time zone.

const project: Project = {
  id: "portal",
  name: "Customer portal",
  client: "ACME",
  billingCode: "AC-7",
  members: [{ repository: "github.com/acme/portal" }],
};

const october = parseStatementPeriod("2026-10", "Europe/Tallinn")!;
const inputs: StatementInputs = {
  project,
  period: october,
  generatedAt: "2026-11-06T12:00:00.000Z",
  appVersion: "0.9.0",
  priceBookHash: "pb1",
  projectsFileHash: "pf1",
};

const priced = (amount: number, versionId: string, parts: { uncachedInput: number; cacheRead: number; cacheWrite: number; output: number }, apiEquivalent = false): CostFigure => ({
  known: true,
  amount,
  currency: "USD",
  basis: "priced",
  priceVersionIds: [versionId],
  byTokenType: parts,
  ...(apiEquivalent ? { apiEquivalent: true } : {}),
});

const row = (at: string, overrides: Parameters<typeof cubeRow>[0] extends infer T ? Partial<T> : never = {}) =>
  cubeRow({ date: at.slice(0, 10), at, projectId: "portal", ...overrides });

describe("buildStatement", () => {
  it("makes one line per basis, currency, channel, model and price version, with tokens and unit prices", () => {
    const cube = cubeOf([
      row("2026-10-05T10:00:00Z", { sessionKey: "vscode:s1", providerId: "vscode", sessionId: "s1", sessionTitle: "Fix", model: "gpt-5.5", channel: "github-copilot", cost: costs({ billed: billed(100) }) }),
      row("2026-10-06T10:00:00Z", { sessionKey: "vscode:s1", providerId: "vscode", sessionId: "s1", sessionTitle: "Fix", model: "gpt-5.5", channel: "github-copilot", cost: costs({ billed: billed(20) }) }),
      row("2026-10-07T10:00:00Z", {
        sessionKey: "pi-agent:p1",
        providerId: "pi-agent",
        sessionId: "p1",
        sessionTitle: "Tests",
        model: "claude-sonnet-5.5",
        channel: "anthropic-api",
        uncachedInput: 1_000_000,
        cacheRead: 2_000_000,
        cacheWrite: 0,
        output: 100_000,
        cost: costs({ priced: priced(4.1, "a:sonnet:v1", { uncachedInput: 3, cacheRead: 0.6, cacheWrite: 0, output: 0.5 }) }),
      }),
    ]);
    const statement = statementSchema.parse(buildStatement(cube, inputs));
    expect(statement.lines.map((line) => [line.key, line.sessions, line.turns, line.amount])).toEqual([
      ["billed|AI_CREDITS|github-copilot|gpt-5.5|", 1, 2, 120],
      ["priced|USD|anthropic-api|claude-sonnet-5.5|a:sonnet:v1", 1, 1, 4.1],
    ]);
    expect(statement.lines[1]).toMatchObject({ tokens: { uncachedInput: 1_000_000, cacheRead: 2_000_000, cacheWrite: 0, output: 100_000 }, unitPrices: { uncachedInput: 3, cacheRead: 0.3, cacheWrite: null, output: 5 } });
    expect(statement.lines[0]!.unitPrices).toBeNull();
    expect(statement.totals).toEqual([
      { currency: "AI_CREDITS", lines: 120, markup: 0, fixed: 0, total: 120 },
      { currency: "USD", lines: 4.1, markup: 0, fixed: 0, total: 4.1 },
    ]);
    expect(statement.provenance).toMatchObject({
      appVersion: "0.9.0",
      priceBookHash: "pb1",
      projectsFileHash: "pf1",
      priceVersionIds: ["a:sonnet:v1"],
      sessions: [
        { providerId: "pi-agent", sessionId: "p1", title: "Tests" },
        { providerId: "vscode", sessionId: "s1", title: "Fix" },
      ],
    });
    expect(statement).toMatchObject({ status: "draft", project: { id: "portal", name: "Customer portal", client: "ACME", billingCode: "AC-7" }, period: october });
  });

  it("bills by calendar day in the statement's time zone (D6)", () => {
    const cube = cubeOf([
      // 22:30Z on Sep 30 is Oct 1 in Tallinn (UTC+3): in.
      row("2026-09-30T22:30:00Z", { cost: costs({ billed: billed(1) }) }),
      // 22:30Z on Oct 31 is Nov 1 in Tallinn (UTC+2 after the DST change): out.
      row("2026-10-31T22:30:00Z", { cost: costs({ billed: billed(10) }) }),
    ]);
    expect(buildStatement(cube, inputs).totals).toEqual([{ currency: "AI_CREDITS", lines: 1, markup: 0, fixed: 0, total: 1 }]);
  });

  it("only takes the project's turns", () => {
    const cube = cubeOf([row("2026-10-05T10:00:00Z", { projectId: "billing", cost: costs({ billed: billed(5) }) })]);
    expect(buildStatement(cube, inputs).lines).toEqual([]);
  });

  it("lists turns with no known cost by reason, counted and never summed as 0", () => {
    const cube = cubeOf([
      row("2026-10-05T10:00:00Z", { cost: costs({ billed: billed(10) }) }),
      row("2026-10-05T11:00:00Z", { cost: costs({ priced: unknownFigure("Cannot price: unknown model") }) }),
      row("2026-10-05T12:00:00Z", { cost: costs({ priced: unknownFigure("Cannot price: unknown model") }) }),
    ]);
    const statement = buildStatement(cube, inputs);
    expect(statement.unknown).toEqual([{ reason: expect.stringContaining("Cannot price: unknown model"), turns: 2, sessions: 2 }]);
    expect(statement.coverage).toEqual({ turns: 3, knownTurns: 1 });
  });

  it("leaves subscription (API-equivalent) use off unless the project includes it (D4)", () => {
    const cube = cubeOf([row("2026-10-05T10:00:00Z", { cost: costs({ priced: priced(2, "v", { uncachedInput: 2, cacheRead: 0, cacheWrite: 0, output: 0 }, true) }) })]);
    const off = buildStatement(cube, inputs);
    expect(off.lines).toEqual([]);
    expect(off.excluded).toEqual([{ reason: expect.stringMatching(/API-equivalent/), turns: 1, sessions: 1 }]);
    const on = buildStatement(cube, { ...inputs, project: { ...project, includeSubscriptionUse: true } });
    expect(on).toMatchObject({ includeSubscriptionUse: true, excluded: [], lines: [{ apiEquivalent: true, amount: 2 }] });
  });

  it("adds the project's markup per currency, its fixed lines, and its user currency at the fixed rate (D13, D14)", () => {
    const cube = cubeOf([
      row("2026-10-05T10:00:00Z", { cost: costs({ billed: billed(1000) }) }),
      row("2026-10-05T11:00:00Z", { model: "x", cost: costs({ reported: reported(5) }) }),
    ]);
    const withRates = { ...project, rates: { markupPercent: 10, fixedLines: [{ label: "Seats", amount: 39, currency: "USD" as const }], currency: { code: "EUR", perUsd: 0.9 } } };
    const statement = statementSchema.parse(buildStatement(cube, { ...inputs, project: withRates }));
    expect(statement.markupPercent).toBe(10);
    expect(statement.markup).toEqual([
      { currency: "AI_CREDITS", base: 1000, amount: 100 },
      { currency: "USD", base: 5, amount: 0.5 },
    ]);
    expect(statement.totals).toEqual([
      { currency: "AI_CREDITS", lines: 1000, markup: 100, fixed: 0, total: 1100 },
      { currency: "USD", lines: 5, markup: 0.5, fixed: 39, total: 44.5 },
    ]);
    // (44.5 + 1100 × 0.01) × 0.9 = 49.95
    expect(statement.userCurrency).toEqual({ code: "EUR", perUsd: 0.9, total: 49.95, conversion: "1 USD = 0.9 EUR (the project's fixed rate); 1 AI Credit = $0.01." });
  });

  it("is the same statement for the same inputs (golden-stable ordering)", () => {
    const rows = [
      row("2026-10-05T10:00:00Z", { model: "b", cost: costs({ billed: billed(1) }) }),
      row("2026-10-05T10:00:00Z", { model: "a", cost: costs({ billed: billed(2) }) }),
    ];
    expect(buildStatement(cubeOf(rows), inputs)).toEqual(buildStatement(cubeOf([...rows].reverse()), inputs));
  });
});
