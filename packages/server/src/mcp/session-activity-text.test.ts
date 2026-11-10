// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { rollupActivitySentence, sessionActivitySentence } from "./session-activity-text.js";

const now = new Date("2026-11-10T12:00:00.000Z");

describe("sessionActivitySentence", () => {
  it("says an active session's figures may still change, with how long ago its latest turn started", () => {
    expect(sessionActivitySentence({ active: true, lastTurnAt: "2026-11-10T11:57:00.000Z" }, now)).toBe(
      "This session is active (its latest turn started 3 minutes ago), so its figures may still change and the latest turn may be incomplete.",
    );
  });

  it("uses the singular for one minute and 'just now' under a minute or after now (clock skew)", () => {
    expect(sessionActivitySentence({ active: true, lastTurnAt: "2026-11-10T11:58:30.000Z" }, now)).toContain("started 1 minute ago");
    expect(sessionActivitySentence({ active: true, lastTurnAt: "2026-11-10T11:59:30.000Z" }, now)).toContain("started just now");
    expect(sessionActivitySentence({ active: true, lastTurnAt: "2026-11-10T12:04:00.000Z" }, now)).toContain("started just now");
  });

  it("says nothing for a session that isn't active", () => {
    expect(sessionActivitySentence({ lastTurnAt: "2026-11-10T09:00:00.000Z" }, now)).toBeUndefined();
    expect(sessionActivitySentence({}, now)).toBeUndefined();
  });
});

describe("rollupActivitySentence", () => {
  const session = (sessionId: string, title: string, lastTurnAt: string, active?: true) => ({
    providerId: "claude-code",
    sessionId,
    title,
    lastTurnAt,
    ...(active ? { active } : {}),
  });

  it("names the active top sessions in one sentence", () => {
    expect(
      rollupActivitySentence(
        [
          session("a", "Fix tests", "2026-11-10T11:57:00.000Z", true),
          session("b", "Old work", "2026-11-09T11:57:00.000Z"),
          session("c", "Docs", "2026-11-10T11:50:00.000Z", true),
        ],
        now,
      ),
    ).toBe(
      'These top sessions are active, so their figures may still change and their latest turn may be incomplete: "Fix tests" (claude-code a, latest turn started 3 minutes ago); "Docs" (claude-code c, latest turn started 10 minutes ago).',
    );
  });

  it("uses the singular for one active session", () => {
    expect(rollupActivitySentence([session("a", "Fix tests", "2026-11-10T11:57:00.000Z", true)], now)).toBe(
      'This top session is active, so its figures may still change and its latest turn may be incomplete: "Fix tests" (claude-code a, latest turn started 3 minutes ago).',
    );
  });

  it("says nothing when no top session is active", () => {
    expect(rollupActivitySentence([session("b", "Old work", "2026-11-09T11:57:00.000Z")], now)).toBeUndefined();
    expect(rollupActivitySentence([], now)).toBeUndefined();
  });
});
