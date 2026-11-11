// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { DocumentedChangeView, ObservedChangeView, PriceChangesViewModel, RangeView } from "../../view-models/index.js";

// U13's timeline (board Increment3States.dc.html): the documented and the
// observed changes on one oldest-first rail, each still told apart by its
// kind. The layout is pure so the chart component only draws.

export type TimelineChange = DocumentedChangeView | ObservedChangeView;

export interface TimelineEntry {
  key: string;
  change: TimelineChange;
}

export interface TimelineMark {
  key: string;
  x: number;
  kind: TimelineChange["kind"];
  label: string;
  labelled: boolean; // false when the label would run into the one before
  title: string;
}

export interface TimelineLayout {
  start: { x: number; text: string };
  end: { x: number; text: string };
  marks: TimelineMark[];
}

const DAY_MS = 86_400_000;
const PAD = 8;
const MIN_LABEL_GAP = 40;

const dayOf = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;

export function timelineEntries(vm: PriceChangesViewModel): TimelineEntry[] {
  const all: TimelineChange[] = [...vm.documented, ...vm.observed];
  return all
    .map((change) => ({ key: `${change.kind}:${change.date}:${change.channel}:${change.modelId}`, change }))
    .sort((a, b) => a.change.date.localeCompare(b.change.date) || (a.change.kind === b.change.kind ? 0 : a.change.kind === "documented" ? -1 : 1));
}

export function layoutTimeline(entries: readonly TimelineEntry[], range: RangeView | undefined, width: number): TimelineLayout {
  const first = entries[0]?.change;
  const last = entries[entries.length - 1]?.change;
  const since = range?.since ?? first?.date ?? "";
  const until = range?.until ?? last?.date ?? "";
  const startText = range?.sinceText ?? first?.dateText ?? "";
  const endText = range?.untilText ?? last?.dateText ?? "";
  const left = PAD;
  const right = width - PAD;
  const span = since === "" ? 0 : dayOf(until) - dayOf(since);
  const place = (date: string) => (span <= 0 ? width / 2 : left + ((dayOf(date) - dayOf(since)) / span) * (right - left));
  let previousLabelled = Number.NEGATIVE_INFINITY;
  const marks = entries.map(({ key, change }): TimelineMark => {
    const x = place(change.date);
    const labelled = x - previousLabelled >= MIN_LABEL_GAP;
    if (labelled) previousLabelled = x;
    return { key, x, kind: change.kind, label: change.dateText, labelled, title: `${change.dateText} (${change.kind === "observed" ? "inferred" : "documented"})` };
  });
  return { start: { x: span <= 0 ? width / 2 : left, text: startText }, end: { x: span <= 0 ? width / 2 : right, text: endText }, marks };
}
