import type { SeenSessionTracker } from "../ports/SeenSessionTracker.js";

export class InMemorySeenTracker implements SeenSessionTracker {
  private readonly seen = new Set<string>();

  hasSeen(sessionId: string): boolean {
    return this.seen.has(sessionId);
  }

  markSeen(sessionId: string): void {
    this.seen.add(sessionId);
  }
}
