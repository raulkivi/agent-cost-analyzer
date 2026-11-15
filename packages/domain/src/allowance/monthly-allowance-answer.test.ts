// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { monthlyAllowanceAnswerSchema, type MonthlyAllowanceAnswer } from "./monthly-allowance-answer.js";

const period = { startKey: "2026-11-01", endKeyExclusive: "2026-12-01", timeZone: "Europe/Tallinn", daysLeft: 19, dayOfPeriod: 12 };
const source: MonthlyAllowanceAnswer["source"] = {
  providerId: "vscode",
  available: true,
  variant: "VS Code Insiders",
  byHarness: [
    { harness: "local", known: 12, total: 15, used: 700.4 },
    { harness: "agent-host", known: 1, total: 5, used: 112 },
  ],
};

// Every field but the state and its figures.
const base = {
  settings: { aiCredits: 1000, resetDay: 1, warnAtPercent: 80 },
  period,
  source,
  asOf: "2026-11-12T10:00:00.000Z",
};

const known: MonthlyAllowanceAnswer = {
  ...base,
  state: "known",
  figures: { level: "near", used: 812.4, atLeast: true, percent: 81, remaining: 187.6, coverage: { known: 13, total: 20 }, countedSinceKey: "2026-11-02" },
};
const unknown: MonthlyAllowanceAnswer = { ...base, state: "unknown", figures: { coverage: { known: 0, total: 3 }, countedSinceKey: "2026-11-02" } };
const noSessions: MonthlyAllowanceAnswer = { ...base, state: "no-sessions", figures: { coverage: { known: 0, total: 0 } } };
const noSource: MonthlyAllowanceAnswer = {
  ...base,
  state: "no-source",
  source: { providerId: "vscode", available: false, reason: "No Copilot Chat logs found on this machine", variant: null, byHarness: [] },
};
const notSet: MonthlyAllowanceAnswer = { ...base, settings: { aiCredits: null, resetDay: 1, warnAtPercent: 80 }, state: "not-set" };

const accepts = (answer: unknown) => monthlyAllowanceAnswerSchema.safeParse(answer).success;

describe("monthlyAllowanceAnswerSchema", () => {
  it.each([
    ["known", known],
    ["unknown", unknown],
    ["no-sessions", noSessions],
    ["no-source", noSource],
    ["not-set", notSet],
  ])("accepts a %s answer", (_state, answer) => {
    expect(monthlyAllowanceAnswerSchema.parse(answer)).toEqual(answer);
  });

  it("accepts an exact sum (not 'at least') when every session has cost data", () => {
    expect(accepts({ ...known, figures: { ...known.figures, atLeast: false, coverage: { known: 20, total: 20 } } })).toBe(true);
  });

  describe("unknown is never 0", () => {
    it("rejects a known answer with no session that has cost data", () => {
      expect(accepts({ ...known, figures: { ...known.figures, used: 0, atLeast: false, coverage: { known: 0, total: 3 } } })).toBe(false);
    });

    it("rejects a figure (used, percent, remaining or level) in the unknown and no-sessions states", () => {
      expect(accepts({ ...unknown, figures: { ...unknown.figures, used: 0 } })).toBe(false);
      expect(accepts({ ...unknown, figures: known.figures })).toBe(false);
      expect(accepts({ ...noSessions, figures: { coverage: { known: 0, total: 0 }, percent: 0 } })).toBe(false);
    });

    it("rejects an unknown state that has a session with cost data, and a no-sessions state with a session", () => {
      expect(accepts({ ...unknown, figures: { coverage: { known: 1, total: 3 }, countedSinceKey: "2026-11-02" } })).toBe(false);
      expect(accepts({ ...unknown, figures: { coverage: { known: 0, total: 0 } } })).toBe(false);
      expect(accepts({ ...noSessions, figures: { coverage: { known: 0, total: 1 } } })).toBe(false);
    });

    it("rejects 'at least' that does not match the coverage", () => {
      expect(accepts({ ...known, figures: { ...known.figures, atLeast: false } })).toBe(false);
      expect(accepts({ ...known, figures: { ...known.figures, atLeast: true, coverage: { known: 20, total: 20 } } })).toBe(false);
    });

    it("rejects more known sessions than sessions, in the figures and in a harness", () => {
      expect(accepts({ ...known, figures: { ...known.figures, coverage: { known: 21, total: 20 } } })).toBe(false);
      expect(accepts({ ...known, source: { ...source, byHarness: [{ harness: "local", known: 2, total: 1, used: 3 }] } })).toBe(false);
    });

    it("rejects a harness sum of 0 with no known session, and a missing sum with known sessions", () => {
      expect(accepts({ ...known, source: { ...source, byHarness: [{ harness: "local", known: 0, total: 4, used: 0 }] } })).toBe(false);
      expect(accepts({ ...known, source: { ...source, byHarness: [{ harness: "local", known: 2, total: 4, used: null }] } })).toBe(false);
      expect(accepts({ ...known, source: { ...source, byHarness: [{ harness: "local", known: 0, total: 4, used: null }] } })).toBe(true);
    });
  });

  describe("state and figures belong together", () => {
    it("has figures only in the known, unknown and no-sessions states", () => {
      expect(accepts({ ...base, state: "known" })).toBe(false);
      expect(accepts({ ...base, state: "unknown" })).toBe(false);
      expect(accepts({ ...base, state: "no-sessions" })).toBe(false);
      expect(accepts({ ...notSet, figures: noSessions.figures })).toBe(false);
      expect(accepts({ ...noSource, figures: noSessions.figures })).toBe(false);
    });

    it("is not-set exactly when the allowance is null", () => {
      expect(accepts({ ...notSet, settings: known.settings })).toBe(false);
      expect(accepts({ ...known, settings: notSet.settings })).toBe(false);
      expect(accepts({ ...noSource, settings: notSet.settings })).toBe(false);
    });

    it("is no-source exactly when the Copilot logs are unavailable (allowance set)", () => {
      expect(accepts({ ...noSource, source })).toBe(false);
      expect(accepts({ ...known, source: noSource.source })).toBe(false);
      expect(accepts({ ...notSet, source: noSource.source })).toBe(true);
    });
  });

  describe("only figures, day keys and fixed labels: no logged text", () => {
    it("rejects a key it does not know, at every level", () => {
      expect(accepts({ ...known, sessionIds: ["s1"] })).toBe(false);
      expect(accepts({ ...known, figures: { ...known.figures, title: "secret-repo" } })).toBe(false);
      expect(accepts({ ...known, period: { ...period, path: "/home/me" } })).toBe(false);
      expect(accepts({ ...known, source: { ...source, path: "/home/me/.config/Code" } })).toBe(false);
      expect(accepts({ ...known, source: { ...source, byHarness: [{ ...source.byHarness[0], repository: "secret-repo" }] } })).toBe(false);
      expect(accepts({ ...known, settings: { ...known.settings, note: "x" } })).toBe(false);
    });

    it("names the VS Code variant with a fixed label, never a path", () => {
      expect(accepts({ ...known, source: { ...source, variant: "VS Code" } })).toBe(true);
      expect(accepts({ ...known, source: { ...source, variant: "/home/me/.config/Code - Insiders" } })).toBe(false);
      expect(accepts({ ...known, source: { ...source, providerId: "claude-code" } })).toBe(false);
    });

    it("takes day keys as calendar dates and the instant as an ISO date-time", () => {
      expect(accepts({ ...known, period: { ...period, startKey: "2026-11-31" } })).toBe(false);
      expect(accepts({ ...known, figures: { ...known.figures, countedSinceKey: "yesterday" } })).toBe(false);
      expect(accepts({ ...known, asOf: "today" })).toBe(false);
      expect(accepts({ ...known, period: { ...period, timeZone: "" } })).toBe(false);
    });
  });

  it("is an object at the top level, as an MCP tool's output schema must be", () => {
    expect(z.toJSONSchema(monthlyAllowanceAnswerSchema, { io: "output" })).toMatchObject({ type: "object" });
  });
});
