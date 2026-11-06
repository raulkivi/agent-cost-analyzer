import { describe, expect, it } from "vitest";
import { clockFromEnv, FIXED_NOW_ENV } from "./clock-from-env.js";

// Phase 15 step 15.9 (plan §12.4.1): the usage-scenario suite runs the real
// server at a fixed time, so "last 90 days" and "today's prices" are the
// same on every run.
describe("clockFromEnv", () => {
  it("is undefined (the real clock) when the variable is unset or empty", () => {
    expect(clockFromEnv({})).toBeUndefined();
    expect(clockFromEnv({ [FIXED_NOW_ENV]: "" })).toBeUndefined();
  });

  it("returns that instant, every time, for an ISO timestamp", () => {
    const now = clockFromEnv({ [FIXED_NOW_ENV]: "2026-11-06T12:00:00.000Z" });
    expect(now?.().toISOString()).toBe("2026-11-06T12:00:00.000Z");
    expect(now?.().getTime()).toBe(Date.parse("2026-11-06T12:00:00.000Z"));
  });

  it("refuses a value that isn't a timestamp, rather than running on a wrong clock", () => {
    expect(() => clockFromEnv({ [FIXED_NOW_ENV]: "yesterday" })).toThrow(/AGENT_COST_ANALYZER_NOW/);
  });
});
