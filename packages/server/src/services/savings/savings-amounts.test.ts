// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { SavingsAmount } from "@agent-cost-analyzer/domain";
import { session, sessionInput } from "../../test-support/savings-fakes.js";
import { NotAnalysedLedger, sessionRefOf, unknownAmount } from "./savings-amounts.js";

// V24: the reference a detector puts on a row for one session.
describe("sessionRefOf", () => {
  const amount: SavingsAmount = { known: true, currency: "USD", low: 1, high: 2, basis: "priced", label: "range", priceVersionIds: ["v1"] };

  it("carries the provider, the id, the start as an ISO timestamp and the saving", () => {
    const ref = sessionRefOf(sessionInput(session("s1", { startedAt: "2026-10-15T12:00:00Z" })), amount);
    expect(ref).toEqual({ providerId: "claude-code", sessionId: "s1", startedAt: "2026-10-15T12:00:00.000Z", perWindow: amount });
  });

  it("leaves the start out when the log has none or it is not a date, never a made-up one", () => {
    expect(sessionRefOf(sessionInput(session("s1", { startedAt: undefined })), amount)).not.toHaveProperty("startedAt");
    expect(sessionRefOf(sessionInput(session("s1", { startedAt: "someday" })), amount)).not.toHaveProperty("startedAt");
  });

  it("keeps an unknown saving unknown, with its reason", () => {
    expect(sessionRefOf(sessionInput(session("s1")), unknownAmount("No price.")).perWindow).toEqual({ known: false, reason: "No price." });
  });
});

// A row's coverage names each reason once: the ledger keeps a provider apart
// (the report-level list needs that), the row has no provider column.
describe("NotAnalysedLedger.coverage", () => {
  it("merges the same reason from several providers into one entry with the summed count", () => {
    const ledger = new NotAnalysedLedger();
    ledger.add(sessionInput(session("a", { providerId: "claude-code" })), "No inventory.");
    ledger.add(sessionInput(session("b", { providerId: "claude-code" })), "No inventory.");
    ledger.add(sessionInput(session("c", { providerId: "vscode" })), "No inventory.");
    ledger.add(sessionInput(session("d", { providerId: "vscode" })), "No requests.");
    expect(ledger.coverage(10).notAnalysed).toEqual([{ reason: "No inventory.", sessions: 3 }, { reason: "No requests.", sessions: 1 }]);
  });

  it("keeps the report-level list split by provider", () => {
    const ledger = new NotAnalysedLedger();
    ledger.add(sessionInput(session("a", { providerId: "claude-code" })), "No inventory.");
    ledger.add(sessionInput(session("c", { providerId: "vscode" })), "No inventory.");
    expect(ledger.report("unused-tools")).toHaveLength(2);
  });

  it("merges a reason from the extra sessions into the ledger's entry", () => {
    const ledger = new NotAnalysedLedger();
    const a = sessionInput(session("a"));
    const b = sessionInput(session("b"));
    ledger.add(a, "No inventory.");
    expect(ledger.coverage(5, new Map([["No inventory.", new Set([b])]])).notAnalysed).toEqual([{ reason: "No inventory.", sessions: 2 }]);
  });
});
