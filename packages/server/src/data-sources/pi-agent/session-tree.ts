import type { PiRawEntry } from "./pi-jsonl-reader.js";

// pi's JSONL body is an append-only serialization of a tree (forks/rewinds
// create siblings sharing an ancestor), not a flat history — see
// https://pi.dev/docs/latest/session-format. A "leaf" is any entry that is
// nobody's parentId: the tip of one branch. A file with no forks has exactly
// one leaf (its last-written entry); a forked file has one leaf per
// still-open branch.
export function findLeafEntryIds(entries: PiRawEntry[]): string[] {
  const parentIds = new Set(
    entries.map((e) => e.parentId).filter((id): id is string => typeof id === "string"),
  );
  return entries
    .map((e) => e.id)
    .filter((id): id is string => typeof id === "string" && !parentIds.has(id));
}

// Walks parentId back from `leafId` to the root (an entry whose parentId
// isn't present among `entries` — typically the session header, which this
// module never sees directly), returning entries in root-to-leaf order.
// Sibling branches created by a fork are naturally excluded, since only one
// parentId chain leads to any given leaf.
export function walkBranch(entries: PiRawEntry[], leafId: string): PiRawEntry[] {
  const byId = new Map(
    entries
      .filter((e): e is PiRawEntry & { id: string } => typeof e.id === "string")
      .map((e) => [e.id, e]),
  );

  const chain: PiRawEntry[] = [];
  let currentId: string | undefined = leafId;
  while (currentId !== undefined) {
    const current = byId.get(currentId);
    if (!current) {
      break;
    }
    chain.push(current);
    currentId = current.parentId;
  }

  return chain.reverse();
}
