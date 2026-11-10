// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { ACTIVE_SESSION_WINDOW_MINUTES } from "@agent-cost-analyzer/domain";

// docs/plans/mcp-apps.md §4.7: one rule for every log provider. A running
// chat's log is incomplete (the latest turn is undercounted), so its figures
// are flagged as possibly still changing. Pure: the caller passes the clock.

export interface SessionActivity {
  lastTurnAt?: string;
  active?: true;
}

const WINDOW_MS = ACTIVE_SESSION_WINDOW_MINUTES * 60_000;

// Only turns' own start times count: a turn without one is never guessed
// from the session's start.
export function latestTurnStart(turnStarts: readonly (string | undefined)[]): string | undefined {
  const times = turnStarts.map((start) => (start ? new Date(start).getTime() : Number.NaN)).filter((time) => !Number.isNaN(time));
  return times.length ? new Date(Math.max(...times)).toISOString() : undefined;
}

// A start after `now` is clock skew between the agent and this server, so it
// counts as active rather than being dropped.
export function sessionActivity(turnStarts: readonly (string | undefined)[], now: Date): SessionActivity {
  const lastTurnAt = latestTurnStart(turnStarts);
  if (!lastTurnAt) return {};
  const active = now.getTime() - new Date(lastTurnAt).getTime() <= WINDOW_MS;
  return active ? { lastTurnAt, active } : { lastTurnAt };
}
