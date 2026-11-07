import { createHash } from "node:crypto";
import { isLocalRepositoryKey, redactRepositoryKey, repositoryFolderLabel, type RepositoryAttribution, type Session } from "@agent-cost-analyzer/domain";
import { identityTranslate, type Translate } from "../l10n/localize.js";
import { dayKeyOf, previousDayKey, timeOfDayOf } from "../time/local-time.js";
import { formatAiCredits, groupDescription, startOf, toSessionNode, type GroupNode, type SessionNode } from "./sessions-tree-model.js";

// Phase 15 step 15.14 (plan §11.9, board 7): the Sessions tree grouped by
// the repository each session's folder belongs to, as plain data. Pure and
// free of `vscode`, like the day tree it sits beside.

// The repository a session worked in (SessionAttributor's, in the extension).
export type RepositoryOf = (session: Session) => RepositoryAttribution;

const NO_REPOSITORY_ID = "no-repository";
const REPOSITORY_ID_PREFIX = "repository:";

interface Member {
  session: Session;
  start: Date | undefined;
}

interface Bucket {
  id: string;
  label: string;
  // The repository as a person reads it: the key, or a local one's folder.
  name: string;
  members: Member[];
  reasons: string[];
}

function knownTotal(members: Member[]): { known: number; total: number } {
  let known = 0;
  let total = 0;
  for (const { session } of members) {
    if (session.costAiCredits.known) {
      known += 1;
      total += session.costAiCredits.value;
    }
  }
  return { known, total };
}

// A stable TreeItem id. A local key's path never leaves the host, even as an
// id: its folder name and a short hash (two "app" folders stay apart).
function groupId(key: string): string {
  if (!isLocalRepositoryKey(key)) return REPOSITORY_ID_PREFIX + key;
  return `${REPOSITORY_ID_PREFIX}${redactRepositoryKey(key)}#${createHash("sha256").update(key).digest("hex").slice(0, 12)}`;
}

// §10.1.5: a local key carries a path on this machine, so it is named by its
// folder only.
function repositoryLabel(key: string, t: Translate): string {
  return isLocalRepositoryKey(key) ? t("{0} (local)", repositoryFolderLabel(key)) : key;
}

// "2 sessions · 2.00 AI Credits · 1 unknown": whole messages, not suffixes.
function summary(members: Member[], t: Translate): string {
  const { known, total } = knownTotal(members);
  const sessions = members.length === 1 ? t("{0} session", 1) : t("{0} sessions", members.length);
  const unknown = members.length - known;
  if (known === 0) return t("{0} · {1} unknown", sessions, unknown);
  const credits = t("{0} AI Credits", formatAiCredits(total));
  return unknown === 0 ? t("{0} · {1}", sessions, credits) : t("{0} · {1} · {2} unknown", sessions, credits, unknown);
}

// Beside the cost: "Today 14:02", "Yesterday" or the day, as on board 7.
function dayText(start: Date | undefined, now: Date, timeZone: string | undefined, t: Translate): string | undefined {
  if (!start) return undefined;
  const today = dayKeyOf(now, timeZone);
  const day = dayKeyOf(start, timeZone);
  if (day === today) return t("Today {0}", timeOfDayOf(start, timeZone));
  return day === previousDayKey(today) ? t("Yesterday") : day;
}

function sessionNode(member: Member, now: Date, timeZone: string | undefined, t: Translate): SessionNode {
  const node = toSessionNode(member.session, member.start, timeZone, t);
  const day = dayText(member.start, now, timeZone, t);
  return day ? { ...node, description: t("{0} · {1}", node.description, day) } : node;
}

function newestFirst(a: Member, b: Member): number {
  if (!a.start || !b.start) return a.start ? -1 : b.start ? 1 : 0;
  return b.start.getTime() - a.start.getTime();
}

function newest(members: Member[]): number {
  return Math.max(...members.map((member) => member.start?.getTime() ?? Number.NEGATIVE_INFINITY));
}

// Groups with a known total first, highest first (ties by name), then the
// ones with none; No repository last. The group holding the newest session
// is expanded, as Today is in the day tree.
export function buildSessionsByRepositoryTree(
  sessions: Session[],
  repositoryOf: RepositoryOf,
  now: Date,
  timeZone?: string,
  t: Translate = identityTranslate,
): GroupNode[] {
  const buckets = new Map<string, Bucket>();
  for (const session of sessions) {
    const attribution = repositoryOf(session);
    const id = attribution.attributed ? groupId(attribution.repository.key) : NO_REPOSITORY_ID;
    let bucket = buckets.get(id);
    if (!bucket) {
      const name = attribution.attributed ? repositoryLabel(attribution.repository.key, t) : t("No repository");
      bucket = { id, label: name, name, members: [], reasons: [] };
      buckets.set(id, bucket);
    }
    bucket.members.push({ session, start: startOf(session) });
    if (!attribution.attributed && !bucket.reasons.includes(attribution.reason)) bucket.reasons.push(attribution.reason);
  }

  const ordered = [...buckets.values()].sort((a, b) => {
    if (a.id === NO_REPOSITORY_ID || b.id === NO_REPOSITORY_ID) return a.id === NO_REPOSITORY_ID ? 1 : -1;
    const [ka, kb] = [knownTotal(a.members), knownTotal(b.members)];
    if ((ka.known === 0) !== (kb.known === 0)) return ka.known === 0 ? 1 : -1;
    return kb.total - ka.total || a.name.localeCompare(b.name);
  });
  const newestTime = Math.max(...ordered.map((bucket) => newest(bucket.members)));
  const expandedId = ordered.find((bucket) => newest(bucket.members) === newestTime)?.id;

  return ordered.map((bucket) => {
    const members = [...bucket.members].sort(newestFirst);
    return {
      kind: "group",
      id: bucket.id,
      label: bucket.label,
      description: groupDescription(members.map((member) => member.session), t),
      tooltip: [bucket.name, summary(members, t), ...bucket.reasons].join("\n"),
      expanded: bucket.id === expandedId,
      children: members.map((member) => sessionNode(member, now, timeZone, t)),
    };
  });
}
