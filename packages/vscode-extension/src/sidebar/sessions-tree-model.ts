import type { Session } from "@agent-cost-analyzer/domain";
import { identityTranslate, type Translate } from "../l10n/localize.js";
import { dayKeyOf, previousDayKey, timeOfDayOf } from "../time/local-time.js";

// The Sessions tree as plain data (vscode-extension.md D10, step 10.6). Pure
// and free of `vscode`: vscode/vscode-sessions-view.ts turns these nodes into
// TreeItems.

export interface SessionNode {
  kind: "session";
  sessionId: string;
  label: string;
  description: string;
  tooltip: string;
  ariaLabel: string;
}

export interface GroupNode {
  kind: "group";
  // The day ("2026-10-24") or "undated": stable across refreshes, so the
  // tree keeps its expanded state.
  id: string;
  label: string;
  description: string;
  expanded: boolean;
  children: SessionNode[];
}

// A line of text in place of sessions, e.g. why there are none.
export interface MessageNode {
  kind: "message";
  label: string;
  description: string;
  icon: "error";
}

export type SessionsTreeNode = GroupNode | SessionNode | MessageNode;

const UNDATED_ID = "undated";
const MODEL_UNKNOWN = "unknown";

// 2 decimals, the same rule as the web app's formatAiCredits (a one-line
// duplicate: pulling web code into the host isn't worth it for this).
function formatAiCredits(value: number): string {
  return value.toFixed(2);
}

// Whole messages for the singular and plural, not a suffix: other languages
// pluralise differently.
function turnCountText(count: number, t: Translate): string {
  return count === 1 ? t("{0} turn", count) : t("{0} turns", count);
}

// A valid start instant, or undefined: an absent or unparseable startedAt
// puts the session in the Undated group rather than guessing a date.
function startOf(session: Session): Date | undefined {
  if (session.startedAt === undefined) {
    return undefined;
  }
  const time = Date.parse(session.startedAt);
  return Number.isNaN(time) ? undefined : new Date(time);
}

function costText(session: Session, t: Translate): string {
  return session.costAiCredits.known ? formatAiCredits(session.costAiCredits.value) : t("AI Credits unknown");
}

function toSessionNode(session: Session, start: Date | undefined, timeZone: string | undefined, t: Translate): SessionNode {
  const cost = costText(session, t);
  const turns = turnCountText(session.turnCount, t);
  const started = start
    ? t("started {0} {1}", dayKeyOf(start, timeZone), timeOfDayOf(start, timeZone))
    : t("start time unknown");
  const hasModel = session.model !== "" && session.model !== MODEL_UNKNOWN;
  const details = hasModel ? t("{0} · {1} · {2}", turns, started, session.model) : t("{0} · {1}", turns, started);
  const costLine = session.costAiCredits.known ? t("{0} AI Credits", cost) : cost;
  return {
    kind: "session",
    sessionId: session.id,
    label: session.title,
    description: cost,
    tooltip: `${session.title}\n${details}\n${costLine}`,
    ariaLabel: t("{0}, {1}, {2}", session.title, costLine, turns),
  };
}

// "12.40 · 1 unknown": the known costs summed, then how many are unknown.
// With none known there's no sum to show — never a 0 (constraint 6).
function groupDescription(sessions: Session[], t: Translate): string {
  let known = 0;
  let total = 0;
  for (const session of sessions) {
    if (session.costAiCredits.known) {
      known += 1;
      total += session.costAiCredits.value;
    }
  }
  const unknown = sessions.length - known;
  if (unknown === 0) {
    return formatAiCredits(total);
  }
  return known === 0 ? t("{0} unknown", unknown) : t("{0} · {1} unknown", formatAiCredits(total), unknown);
}

interface Dated {
  session: Session;
  start: Date | undefined;
}

// Sessions grouped by local day (newest day first, then newest session
// first; equal instants keep their input order), with an Undated group
// last. `now` and `timeZone` decide what "Today" and "Yesterday" are.
export function buildSessionsTree(sessions: Session[], now: Date, timeZone?: string, t: Translate = identityTranslate): GroupNode[] {
  const today = dayKeyOf(now, timeZone);
  const yesterday = previousDayKey(today);
  const byDay = new Map<string, Dated[]>();
  const undated: Dated[] = [];
  for (const session of sessions) {
    const start = startOf(session);
    if (!start) {
      undated.push({ session, start });
      continue;
    }
    const day = dayKeyOf(start, timeZone);
    byDay.set(day, [...(byDay.get(day) ?? []), { session, start }]);
  }

  const toGroup = (id: string, label: string, expanded: boolean, members: Dated[]): GroupNode => ({
    kind: "group",
    id,
    label,
    description: groupDescription(members.map((member) => member.session), t),
    expanded,
    children: members.map((member) => toSessionNode(member.session, member.start, timeZone, t)),
  });

  const groups = [...byDay.keys()]
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .map((day) => {
      const members = [...byDay.get(day)!].sort((a, b) => b.start!.getTime() - a.start!.getTime());
      const label = day === today ? t("Today") : day === yesterday ? t("Yesterday") : day;
      return toGroup(day, label, day === today || day === yesterday, members);
    });
  return undated.length > 0 ? [...groups, toGroup(UNDATED_ID, t("Undated"), false, undated)] : groups;
}

// What the view shows when listing the sessions failed: what failed, that
// nothing was changed, and the retry (§3.5 States).
export function sessionsLoadErrorTree(t: Translate = identityTranslate): MessageNode[] {
  return [
    {
      kind: "message",
      label: t("Couldn't read your Copilot Chat sessions"),
      description: t("Nothing was changed. Refresh to retry."),
      icon: "error",
    },
  ];
}
