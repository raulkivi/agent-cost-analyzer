// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { E8_BEATS, E8_MAX_BEAT_MS } from "./e8-beats.mts";

describe("E8 beats", () => {
  it("follow the 1.0 beat list in order: Show Tool Audit on the session with subagent runs, the subagent steps (D39), then All sessions and the bundle", () => {
    expect(E8_BEATS.map((beat) => beat.label)).toEqual([
      "show the Sessions view",
      "Show Tool Audit from the context menu",
      "Agent: Subagents",
      "the runs table: the unread run and its reason",
      "All sessions audit",
      "Copy Advice Bundle: preview",
      "close the dialog without copying",
    ]);
  });

  it("leave room for pointer glides, the probes and the panel's load time inside the 20 s budget", () => {
    const total = E8_BEATS.reduce((sum, beat) => sum + beat.beatMs, 0);
    expect(total).toBeLessThanOrEqual(E8_MAX_BEAT_MS);
  });
});
