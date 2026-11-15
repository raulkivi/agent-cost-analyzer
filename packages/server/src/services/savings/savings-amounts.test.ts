// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { SavingsAmount } from "@agent-cost-analyzer/domain";
import { session, sessionInput } from "../../test-support/savings-fakes.js";
import { sessionRefOf, unknownAmount } from "./savings-amounts.js";

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
