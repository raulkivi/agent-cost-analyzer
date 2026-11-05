import { createHash } from "node:crypto";
import type { JsonlEnvelope } from "./main-jsonl-reader.js";

// Joins the debug log's turns (one per user_message) to the session store's
// `turns` rows. The log starts wherever debug logging was switched on, which
// may be mid-session, so "the Nth user_message is store turn N" (the old
// positional join) misattributes usage then. Both sides carry the user's
// message text, so the join compares a digest of it (never the text: the
// narrow log read must not keep prompt content in memory).

export function userMessageDigest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export interface StoreTurnKey {
  index: number;
  digest: string | null;
}

export function storeTurnKeys(
  turns: readonly { turn_index: number; user_message: string | null }[],
): StoreTurnKey[] {
  return turns.map((turn) => ({
    index: turn.turn_index,
    digest: turn.user_message === null ? null : userMessageDigest(turn.user_message),
  }));
}

// One entry per user_message, in log order; null when it carries no content.
export function logTurnDigests(envelopes: readonly JsonlEnvelope[]): (string | null)[] {
  return envelopes
    .filter((envelope) => envelope.type === "user_message")
    .map((envelope) => {
      const digest = envelope.attrs?.contentDigest;
      return typeof digest === "string" ? digest : null;
    });
}

function matchesAt(logDigests: readonly (string | null)[], store: readonly StoreTurnKey[], offset: number): boolean {
  const overlap = Math.min(logDigests.length, store.length - offset);
  if (overlap <= 0) {
    return false;
  }
  for (let i = 0; i < overlap; i++) {
    const digest = logDigests[i];
    if (digest === null || digest !== store[offset + i].digest) {
      return false;
    }
  }
  return true;
}

// For each log turn, the store turn index it belongs to (log turns beyond the
// store's last row continue the numbering), or null when no reliable place
// exists. The log is a contiguous run of the session's turns, so what is
// sought is the one start offset where every overlapping text agrees:
// - exactly one such offset: use it;
// - none or several, with as many log turns as store turns: trust the
//   position (the count agrees, and only a text such as an attachment differs);
// - otherwise unplaced: a wrong turn's number is worse than an unknown one
//   (architecture.md constraint 6).
export function alignLogTurnsToStore(
  logDigests: readonly (string | null)[],
  store: readonly StoreTurnKey[],
): (number | null)[] {
  if (logDigests.length === 0) {
    return [];
  }
  const offsets: number[] = [];
  for (let offset = 0; offset < store.length; offset++) {
    if (matchesAt(logDigests, store, offset)) {
      offsets.push(offset);
    }
  }

  let start: number;
  if (store.length === 0) {
    start = 0;
  } else if (offsets.length === 1) {
    start = offsets[0];
  } else if (logDigests.length === store.length) {
    start = 0;
  } else {
    return logDigests.map(() => null);
  }

  const lastIndex = store.length === 0 ? -1 : store[store.length - 1].index;
  return logDigests.map((_, i) => {
    const position = start + i;
    return position < store.length ? store[position].index : lastIndex + (position - store.length + 1);
  });
}

// Per-log-turn values (usage, invoked tools) laid out by store turn index. The
// result is deliberately sparse: an index no log turn covers stays a hole, so
// callers see "no log data" (`undefined`) rather than a made-up entry.
export function placeByStoreIndex<T>(perLogTurn: readonly T[], alignment: readonly (number | null)[]): T[] {
  const placed: T[] = [];
  perLogTurn.forEach((value, i) => {
    const index = alignment[i];
    if (index !== null && index !== undefined) {
      placed[index] = value;
    }
  });
  return placed;
}
