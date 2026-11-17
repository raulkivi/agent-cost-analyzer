// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { E5_BEATS, E5_MAX_BEAT_MS } from "./e5-beats.mts";

describe("E5 beats", () => {
  it("follow the 1.0 beat list in order", () => {
    expect(E5_BEATS.map((beat) => beat.label)).toEqual([
      "open the analyzer panel",
      "Analyze, then Savings",
      "90 days",
      "back to 30 days",
      "open the top row: its sessions",
      "open the unused-tools row: its tools",
      "close the detail, tick Include simulated",
      "scroll to Not analysed", // codespell:ignore analysed
    ]);
  });

  it("drop the 7-day step and Copy text (D37)", () => {
    const labels = E5_BEATS.map((beat) => beat.label.toLowerCase()).join("|");
    expect(labels).not.toMatch(/7 days|copy text/);
  });

  it("leave room for pointer glides inside the GIF length limit", () => {
    const total = E5_BEATS.reduce((sum, beat) => sum + beat.beatMs, 0);
    expect(total).toBeLessThanOrEqual(E5_MAX_BEAT_MS);
  });
});
