import { describe, expect, it } from "vitest";
import { InMemorySeenTracker } from "../../src/adapters/InMemorySeenTracker.js";

describe("InMemorySeenTracker", () => {
  it("reports a session as unseen until markSeen is called", () => {
    const tracker = new InMemorySeenTracker();

    expect(tracker.hasSeen("session-1")).toBe(false);
    tracker.markSeen("session-1");
    expect(tracker.hasSeen("session-1")).toBe(true);
  });

  it("tracks distinct session ids independently", () => {
    const tracker = new InMemorySeenTracker();
    tracker.markSeen("session-1");

    expect(tracker.hasSeen("session-1")).toBe(true);
    expect(tracker.hasSeen("session-2")).toBe(false);
  });
});
