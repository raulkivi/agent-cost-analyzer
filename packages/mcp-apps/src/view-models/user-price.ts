// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

// 1.0 V2b (threat-model 5.10): the label on a priced figure computed with a
// price version the user added. The ids come from the user's projects file,
// so they are folded and capped like log-derived names before they reach a
// view (the server's savingsName does the same for savings subjects); the
// views render them as text only. Pure.

export const USER_PRICE_TEXT = "your prices";

const MAX_ID_LENGTH = 60;
const MAX_IDS_NAMED = 5;
const UNNAMED = "(unnamed)";
// Control (Cc), format (Cf: bidi and zero-width) and separator characters.
const CONTROL_OR_SPACE_RUN = /[\p{Cc}\p{Cf}\p{Z}\s]+/gu;

export interface UserPriceLabel {
  text: typeof USER_PRICE_TEXT;
  name: string; // the accessible name
}

// One line, whole code points only, at most MAX_ID_LENGTH UTF-16 units.
export function foldVersionId(raw: string): string {
  const folded = raw.replace(CONTROL_OR_SPACE_RUN, " ").trim();
  let capped = "";
  for (const character of folded) {
    if (capped.length + character.length > MAX_ID_LENGTH) break;
    capped += character;
  }
  capped = capped.trim();
  return capped === "" ? UNNAMED : capped;
}

export function userPriceLabel(ids: readonly string[] | undefined): UserPriceLabel | undefined {
  if (ids === undefined || ids.length === 0) return undefined;
  const names = [...new Set(ids.map(foldVersionId))];
  const shown = names.slice(0, MAX_IDS_NAMED).join(", ");
  const more = names.length > MAX_IDS_NAMED ? ` and ${names.length - MAX_IDS_NAMED} more` : "";
  return { text: USER_PRICE_TEXT, name: `Priced with your own price ${names.length === 1 ? "version" : "versions"}: ${shown}${more}` };
}

// The union of several figures' ids, sorted; undefined when there are none.
export function mergeUserPriceIds(...lists: (readonly string[] | undefined)[]): string[] | undefined {
  const merged = [...new Set(lists.flatMap((list) => list ?? []))].sort();
  return merged.length === 0 ? undefined : merged;
}
