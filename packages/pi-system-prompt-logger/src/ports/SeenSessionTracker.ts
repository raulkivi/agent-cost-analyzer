/**
 * Tracks which session ids have already been logged in this process,
 * so we capture the system prompt once per session (first turn only)
 * instead of on every turn.
 */
export interface SeenSessionTracker {
  hasSeen(sessionId: string): boolean;
  markSeen(sessionId: string): void;
}
