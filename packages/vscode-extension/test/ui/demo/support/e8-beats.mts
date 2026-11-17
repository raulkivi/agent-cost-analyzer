// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Pause after each E8 step, in order (docs/plans/demo-recordings-1.0.md §3.3, D39).
// Pure data so the beat list and its budget are unit-tested; the scene supplies the actions.
export const E8_BEATS = [
  { label: "show the Sessions view", beatMs: 300 },
  { label: "Show Tool Audit from the context menu", beatMs: 1_200 },
  { label: "Agent: Subagents", beatMs: 1_100 },
  { label: "the runs table: the unread run and its reason", beatMs: 1_400 },
  { label: "All sessions audit", beatMs: 1_000 },
  { label: "Copy Advice Bundle: preview", beatMs: 1_000 },
  { label: "close the dialog without copying", beatMs: 400 },
] as const;

// Pauses only; glides, clicks, probes and load time come on top, inside the GIF length limit.
export const E8_MAX_BEAT_MS = 6_800;

export type E8Label = (typeof E8_BEATS)[number]["label"];

export const e8BeatMs = (label: E8Label): number => E8_BEATS.find((beat) => beat.label === label)!.beatMs;
