// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { Session } from "../session.js";
import type { TokenCount } from "../token-count.js";
import { billedCredits, knownCredits, knownSum } from "./session-credits.js";

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

  it("keeps a known 0 apart from unknown: it counts as a session with cost data", () => {
    expect(knownSum([session(undefined, known(0)), session(undefined, unknown)], billedCredits)).toEqual({ known: 1, total: 0 });
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
