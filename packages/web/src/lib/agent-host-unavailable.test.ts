import { describe, expect, it } from "vitest";
import { eventLogUnavailableReason } from "./agent-host-unavailable.js";

describe("eventLogUnavailableReason", () => {
  it("is the marker's reason for a missing or unreadable log", () => {
    expect(eventLogUnavailableReason({ copilotEventLog: { status: "missing", reason: "gone" } })).toBe("gone");
    expect(eventLogUnavailableReason({ copilotEventLog: { status: "unreadable", reason: "bad" } })).toBe("bad");
  });

  it("is undefined for a read log and for sessions without a marker", () => {
    expect(eventLogUnavailableReason({ copilotEventLog: { status: "read" } })).toBeUndefined();
    expect(eventLogUnavailableReason({})).toBeUndefined();
    expect(eventLogUnavailableReason(null)).toBeUndefined();
  });
});
