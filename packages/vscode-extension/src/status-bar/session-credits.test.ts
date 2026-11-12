// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Session, TokenCount } from "@agent-cost-analyzer/domain";
import { describe, expect, it } from "vitest";
import { billedCredits, knownCredits, knownSum, sessionDayKey, sessionStartedOn } from "./session-credits.js";

function session(startedAt: string | undefined, costAiCredits: TokenCount): Session {
  return {
    id: "s",
    mode: "analyze",
    title: "s",
    model: "claude-sonnet-5",
    turns: [],
    turnCount: 1,
    costAiCredits,
    usageDataAvailable: true,
    startedAt,
  };
}

const known = (value: number): TokenCount => ({ known: true, value });
const unknown: TokenCount = { known: false, reason: "x" };
const estimated = (value: number): TokenCount => ({ known: true, value, estimated: true });

describe("sessionDayKey", () => {
  it("is the start's day in the given time zone", () => {
    expect(sessionDayKey(session("2026-10-31T22:30:00Z", unknown), "UTC")).toBe("2026-10-31");
    expect(sessionDayKey(session("2026-10-31T22:30:00Z", unknown), "Europe/Helsinki")).toBe("2026-11-01");
  });

  it("is undefined without a start or with an unreadable one", () => {
    expect(sessionDayKey(session(undefined, unknown), "UTC")).toBeUndefined();
    expect(sessionDayKey(session("garbage", unknown), "UTC")).toBeUndefined();
  });
});

describe("sessionStartedOn", () => {
  it("matches the start's day key only", () => {
    expect(sessionStartedOn(session("2026-10-24T09:00:00Z", unknown), "2026-10-24", "UTC")).toBe(true);
    expect(sessionStartedOn(session("2026-10-24T09:00:00Z", unknown), "2026-10-23", "UTC")).toBe(false);
    expect(sessionStartedOn(session(undefined, unknown), "2026-10-24", "UTC")).toBe(false);
  });
});

describe("knownSum", () => {
  it("adds known costs and counts the sessions that have them; an unknown one is never a 0", () => {
    expect(knownSum([session(undefined, known(1.5)), session(undefined, unknown), session(undefined, known(2))])).toEqual({ known: 2, total: 3.5 });
  });

  it("is zero sessions and zero total for an empty list", () => {
    expect(knownSum([])).toEqual({ known: 0, total: 0 });
  });

  it("counts an estimated value by default (today's item, unchanged)", () => {
    expect(knownSum([session(undefined, estimated(4))])).toEqual({ known: 1, total: 4 });
  });

  it("takes which credits count from the caller", () => {
    expect(knownSum([session(undefined, estimated(4)), session(undefined, known(1))], billedCredits)).toEqual({ known: 1, total: 1 });
  });
});

describe("knownCredits and billedCredits", () => {
  it("knownCredits is any known value", () => {
    expect(knownCredits(session(undefined, known(3)))).toBe(3);
    expect(knownCredits(session(undefined, estimated(3)))).toBe(3);
    expect(knownCredits(session(undefined, unknown))).toBeUndefined();
  });

  it("billedCredits drops a local-tokenizer estimate: it was never billed", () => {
    expect(billedCredits(session(undefined, known(3)))).toBe(3);
    expect(billedCredits(session(undefined, { known: true, value: 3, estimated: false }))).toBe(3);
    expect(billedCredits(session(undefined, estimated(3)))).toBeUndefined();
    expect(billedCredits(session(undefined, unknown))).toBeUndefined();
  });
});
