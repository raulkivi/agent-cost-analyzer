// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { latestTurnStart, sessionActivity } from "./session-activity.js";

const now = new Date("2026-11-10T12:00:00.000Z");

describe("latestTurnStart", () => {
  it("is the latest valid turn start, as an ISO time", () => {
    expect(latestTurnStart(["2026-11-10T11:00:00Z", undefined, "2026-11-10T11:30:00+00:00", "not a time"])).toBe("2026-11-10T11:30:00.000Z");
  });

  it("is absent when no turn records a valid start", () => {
    expect(latestTurnStart([])).toBeUndefined();
    expect(latestTurnStart([undefined, "", "garbage"])).toBeUndefined();
  });
});

describe("sessionActivity", () => {
  it("is empty when no turn records a start time: no guess", () => {
    expect(sessionActivity([], now)).toEqual({});
    expect(sessionActivity([undefined, undefined], now)).toEqual({});
  });

  it("flags a session whose latest turn started within 15 minutes as active", () => {
    expect(sessionActivity(["2026-11-10T10:00:00.000Z", "2026-11-10T11:57:00.000Z"], now)).toEqual({
      lastTurnAt: "2026-11-10T11:57:00.000Z",
      active: true,
    });
  });

  it("counts a turn exactly 15 minutes old as active", () => {
    expect(sessionActivity(["2026-11-10T11:45:00.000Z"], now)).toEqual({ lastTurnAt: "2026-11-10T11:45:00.000Z", active: true });
  });

  it("gives only the latest turn start when it is outside the window", () => {
    expect(sessionActivity(["2026-11-10T11:44:59.000Z"], now)).toEqual({ lastTurnAt: "2026-11-10T11:44:59.000Z" });
  });

  it("treats a turn start after now (clock skew) as active", () => {
    expect(sessionActivity(["2026-11-10T12:05:00.000Z"], now)).toEqual({ lastTurnAt: "2026-11-10T12:05:00.000Z", active: true });
  });

  it("ignores invalid dates", () => {
    expect(sessionActivity(["garbage", "2026-11-10T11:00:00.000Z"], now)).toEqual({ lastTurnAt: "2026-11-10T11:00:00.000Z" });
    expect(sessionActivity(["garbage"], now)).toEqual({});
  });
});
