// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { CostMeasures } from "@agent-cost-analyzer/domain";
import { formatTokens } from "./format.js";
import type { MeasureView } from "./format.js";

// Input tokens = uncached + cache write + cache read; one missing part makes
// the total and the cache-hit ratio Unknown (constraint 6). The notes say
// which part is missing and, for the total, which parts are known (A16).
const INPUT_PARTS = [
  ["uncachedInput", "uncached", "uncached input"],
  ["cacheWrite", "cache write", "cache writes"],
  ["cacheRead", "cache read", "cache reads"],
] as const;

export interface InputPartNotes {
  inputTokens?: string;
  cacheHit?: string;
}

export function inputPartNotes(totals: CostMeasures): InputPartNotes {
  const known: string[] = [];
  const missing: string[] = [];
  for (const [key, label, plural] of INPUT_PARTS) {
    const value = totals[key].value;
    if (value === null) missing.push(plural);
    else known.push(`${formatTokens(value)} ${label}`);
  }
  if (known.length === 0 || missing.length === 0) return {};
  const notLogged = `${missing.join(" and ")} not logged`;
  return { inputTokens: `${known.join(" + ")}; ${notLogged}`, cacheHit: notLogged };
}

// Attaches the note to an Unknown view only; a known value needs none.
export function withUnknownNote(view: MeasureView, note: string | undefined): MeasureView {
  return view.known || note === undefined ? view : { ...view, unknownNote: note };
}
