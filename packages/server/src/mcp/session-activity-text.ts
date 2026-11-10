// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

// docs/plans/mcp-apps.md §4.7: the plain sentence a model or non-view host
// reads next to the JSON, so a running chat's figures aren't taken as final
// (a rollup read mid-turn won't reconcile with a later session read).

interface Activity {
  lastTurnAt?: string;
  active?: boolean;
}

interface TopSessionActivity extends Activity {
  providerId: string;
  sessionId: string;
  title: string;
}

// Under a minute, or after now (clock skew), reads as "just now".
function startedAgo(lastTurnAt: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - new Date(lastTurnAt).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
}

export function sessionActivitySentence(cost: Activity, now: Date): string | undefined {
  if (!cost.active || !cost.lastTurnAt) return undefined;
  return `This session is active (its latest turn started ${startedAgo(cost.lastTurnAt, now)}), so its figures may still change and the latest turn may be incomplete.`;
}

export function rollupActivitySentence(topSessions: readonly TopSessionActivity[], now: Date): string | undefined {
  const active = topSessions.flatMap((session) => (session.active && session.lastTurnAt ? [{ ...session, lastTurnAt: session.lastTurnAt }] : []));
  if (active.length === 0) return undefined;
  const named = active
    .map((session) => `${JSON.stringify(session.title)} (${session.providerId} ${session.sessionId}, latest turn started ${startedAgo(session.lastTurnAt, now)})`)
    .join("; ");
  return active.length === 1
    ? `This top session is active, so its figures may still change and its latest turn may be incomplete: ${named}.`
    : `These top sessions are active, so their figures may still change and their latest turn may be incomplete: ${named}.`;
}
