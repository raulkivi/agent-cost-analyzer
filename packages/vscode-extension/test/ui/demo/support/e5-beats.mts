// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Pause after each E5 step, in order (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/demo-recordings-1.0.md §3.3, D37).
// Pure data so the beat list and its budget are unit-tested; the scene supplies the actions.
export const E5_BEATS = [
  { label: "open the analyzer panel", beatMs: 300 },
  { label: "Analyze, then Savings", beatMs: 700 },
  { label: "90 days", beatMs: 500 },
  { label: "back to 30 days", beatMs: 400 },
  { label: "open the top row: its sessions", beatMs: 1_500 },
  { label: "open the unused-tools row: its tools", beatMs: 1_700 },
  { label: "close the detail, tick Include simulated", beatMs: 600 },
  { label: "scroll to Not analysed", beatMs: 1_000 }, // codespell:ignore analysed
] as const;

// Pauses only; pointer glides, clicks and the panel's own load time come on top of this,
// inside the GIF length limit (GIF_DEFAULTS.maxSeconds).
export const E5_MAX_BEAT_MS = 7_000;

export type E5Label = (typeof E5_BEATS)[number]["label"];

export const e5BeatMs = (label: E5Label): number => E5_BEATS.find((beat) => beat.label === label)!.beatMs;
