// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Session } from "@agent-cost-analyzer/domain";
import { describe, expect, it } from "vitest";
import { upperCaseTranslate } from "../l10n/upper-case-translate.js";
import { buildSessionPickItems } from "./session-pick-items.js";

function session(overrides: Partial<Session> & { id: string }): Session {
  return {
    mode: "analyze",
    title: overrides.id,
    model: "m",
    turns: [],
    turnCount: 1,
    costAiCredits: { known: true, value: 1.2 },
    usageDataAvailable: true,
    ...overrides,
  };
}

describe("buildSessionPickItems", () => {
  it("orders newest first, with sessions of no valid start time last in their input order", () => {
    const items = buildSessionPickItems(
      [
        session({ id: "none-1" }),
        session({ id: "old", startedAt: "2026-11-01T09:00:00Z" }),
        session({ id: "bad", startedAt: "not a date" }),
        session({ id: "new", startedAt: "2026-11-07T09:00:00Z" }),
      ],
      undefined,
      "UTC",
    );

    expect(items.map((item) => item.sessionId)).toEqual(["new", "old", "none-1", "bad"]);
  });

  it("labels with the title, describes with time, provider and AI Credits, and puts the id in detail", () => {
    const [item] = buildSessionPickItems(
      [session({ id: "abc-123", title: "Fix the cache", providerId: "copilot", startedAt: "2026-11-07T14:03:00Z" })],
      undefined,
      "UTC",
    );

    expect(item).toEqual({
      label: "Fix the cache",
      description: "2026-11-07 14:03 · copilot · 1.20 AI Credits",
      detail: "abc-123",
      sessionId: "abc-123",
    });
  });

  it("says Unknown, never 0, for AI Credits that are not known", () => {
    const [item] = buildSessionPickItems(
      [session({ id: "u", providerId: "copilot", startedAt: "2026-11-07T14:03:00Z", costAiCredits: { known: false, reason: "no usage data" } })],
      undefined,
      "UTC",
    );

    expect(item!.description).toContain("AI Credits: Unknown");
    expect(item!.description).not.toMatch(/0\.00/);
  });

  it("handles a missing start time and provider", () => {
    const [item] = buildSessionPickItems([session({ id: "x" })], undefined, "UTC");

    expect(item!.description).toBe("start time unknown · 1.20 AI Credits");
  });

  it("translates the text around the data, not the title or provider", () => {
    const [item] = buildSessionPickItems(
      [session({ id: "x", title: "Mixed Case", providerId: "copilot", costAiCredits: { known: false, reason: "no usage data" } })],
      upperCaseTranslate,
      "UTC",
    );

    expect(item!.label).toBe("Mixed Case");
    expect(item!.description).toBe("START TIME UNKNOWN · copilot · AI CREDITS: UNKNOWN");
  });

  it("is empty for no sessions", () => {
    expect(buildSessionPickItems([])).toEqual([]);
  });
});
