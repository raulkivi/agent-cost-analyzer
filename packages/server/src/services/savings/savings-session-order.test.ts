// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { SavingsAmount, SavingsSessionRef } from "@agent-cost-analyzer/domain";
import { sessionsByContribution } from "./savings-session-order.js";

const saving = (high: number): SavingsAmount => ({ known: true, currency: "USD", low: 0, high, basis: "priced", label: "upper-bound", priceVersionIds: ["v"] });
const ref = (sessionId: string, high?: number): SavingsSessionRef => ({ providerId: "p", sessionId, ...(high === undefined ? {} : { perWindow: saving(high) }) });
const ids = (refs: SavingsSessionRef[]) => sessionsByContribution(refs).map((entry) => entry.sessionId);

describe("sessionsByContribution", () => {
  it("puts the largest saving first, read from the reference itself", () => {
    expect(ids([ref("a", 1), ref("b", 5), ref("c", 3)])).toEqual(["b", "c", "a"]);
  });

  it("keeps the given order for equal figures and puts unpriced sessions last", () => {
    const unknown: SavingsSessionRef = { providerId: "p", sessionId: "u", perWindow: { known: false, reason: "No price." } };
    expect(ids([ref("a"), ref("b", 2), unknown, ref("c", 2), ref("d")])).toEqual(["b", "c", "a", "u", "d"]);
  });

  it("returns the references unchanged, with their date and saving", () => {
    const withDate = { ...ref("a", 1), startedAt: "2026-10-15T12:00:00.000Z" };
    expect(sessionsByContribution([withDate])).toEqual([withDate]);
  });
});
