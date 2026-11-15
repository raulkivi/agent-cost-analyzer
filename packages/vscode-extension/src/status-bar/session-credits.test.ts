// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Session, TokenCount } from "@agent-cost-analyzer/domain";
import { describe, expect, it } from "vitest";
import { sessionDayKey, sessionStartedOn } from "./session-credits.js";

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

const unknown: TokenCount = { known: false, reason: "x" };

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
