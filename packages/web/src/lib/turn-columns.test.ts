// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  ALL_TURN_COLUMNS,
  columnsApplyingTo,
  hiddenTurnColumns,
  isReplayColumn,
  parseTurnColumns,
  PRIORITY_TURN_COLUMNS,
  REPLAY_TURN_COLUMNS,
  REQUIRED_TURN_COLUMNS,
  TURN_COLUMNS,
  turnColumnsFor,
} from "./turn-columns.js";

describe("turn columns (§3.5 Layout)", () => {
  it("lists the turns table's 15 columns in display order", () => {
    expect(TURN_COLUMNS.map((column) => column.label)).toEqual([
      "Turn",
      "Trigger",
      "Cache",
      "Rounds",
      "Calls",
      "Uncached in",
      "Cache read",
      "Cache write",
      "Tool",
      "Vision",
      "Reasoning",
      "Output",
      "AI Credits",
      "Cumulative",
      "Model",
    ]);
  });

  it("follows the measured columns with the replay's simulated group (step 14.7)", () => {
    expect(REPLAY_TURN_COLUMNS.map((column) => column.label)).toEqual(["Simulated cache", "Simulated cache read", "Simulated cost"]);
    expect(ALL_TURN_COLUMNS).toEqual([...TURN_COLUMNS, ...REPLAY_TURN_COLUMNS].map((column) => column.id));
  });

  it("never hides Turn, which names the row, or the simulated cost (step 14.7)", () => {
    expect(REQUIRED_TURN_COLUMNS).toEqual(["turn", "replayCost"]);
  });

  it("names the narrow layout's priority columns: Turn, Trigger, AI Credits, Cumulative and the simulated cost", () => {
    expect(PRIORITY_TURN_COLUMNS).toEqual(["turn", "trigger", "aiCredits", "cumulative", "replayCost"]);
  });

  describe("turnColumnsFor", () => {
    it("shows the chosen columns in display order at wide and medium widths", () => {
      expect(turnColumnsFor("wide", ["model", "turn", "aiCredits"])).toEqual(["turn", "aiCredits", "model", "replayCost"]);
      expect(turnColumnsFor("medium", ["model", "turn"])).toEqual(["turn", "model", "replayCost"]);
    });

    it("shows only the priority columns at narrow widths, whatever was chosen", () => {
      expect(turnColumnsFor("narrow", ALL_TURN_COLUMNS)).toEqual(PRIORITY_TURN_COLUMNS);
    });

    it("always keeps the Turn column, which names the row, and the simulated cost", () => {
      expect(turnColumnsFor("wide", ["model"])).toEqual(["turn", "model", "replayCost"]);
    });
  });

  it("lists the columns a layout hides, for the details drawer", () => {
    expect(hiddenTurnColumns(PRIORITY_TURN_COLUMNS)).toEqual([
      "cache",
      "rounds",
      "calls",
      "uncachedInput",
      "cacheRead",
      "cacheWrite",
      "tool",
      "vision",
      "reasoning",
      "output",
      "model",
      "replayCache",
      "replayCacheRead",
    ]);
  });

  describe("parseTurnColumns (a stored choice)", () => {
    it("keeps known column ids, in display order, with Turn", () => {
      expect(parseTurnColumns(["model", "aiCredits", "replayCost"])).toEqual(["turn", "aiCredits", "model", "replayCost"]);
    });

    it("drops unknown ids, e.g. from an older or newer version", () => {
      expect(parseTurnColumns(["model", "gone", 3, "replayCost"])).toEqual(["turn", "model", "replayCost"]);
    });

    it("adds the simulated group to a list saved before it existed (step 14.7)", () => {
      expect(parseTurnColumns(["turn", "model"])).toEqual(["turn", "model", "replayCache", "replayCacheRead", "replayCost"]);
    });

    it("leaves a deliberate choice that hid simulated columns", () => {
      expect(parseTurnColumns(["turn", "model", "replayCost"])).toEqual(["turn", "model", "replayCost"]);
    });

    it("adds the Cache column to an older list that showed every other column", () => {
      const legacy = TURN_COLUMNS.map((column) => column.id).filter((id) => id !== "cache");
      expect(parseTurnColumns(legacy)).toEqual(ALL_TURN_COLUMNS);
    });

    it("leaves a deliberate older choice without Cache", () => {
      expect(parseTurnColumns(["turn", "model", "replayCost"])).toEqual(["turn", "model", "replayCost"]);
    });

    it("reads nothing usable as no stored choice", () => {
      expect(parseTurnColumns(undefined)).toBeUndefined();
      expect(parseTurnColumns("model")).toBeUndefined();
      expect(parseTurnColumns({ columns: [] })).toBeUndefined();
    });
  });

  describe("columnsApplyingTo", () => {
    it("drops Cache unless the turns are simulated", () => {
      expect(columnsApplyingTo(["turn", "cache", "model"], false)).toEqual(["turn", "model"]);
      expect(columnsApplyingTo(["turn", "cache", "model"], true)).toEqual(["turn", "cache", "model"]);
    });

    it("drops the simulated group unless a replay is shown (step 14.7)", () => {
      const columns = ["turn", "model", "replayCache", "replayCost"] as const;
      expect(columnsApplyingTo(columns, false)).toEqual(["turn", "model"]);
      expect(columnsApplyingTo(columns, false, true)).toEqual(columns);
    });

    it("tells the simulated columns apart", () => {
      expect(isReplayColumn("replayCacheRead")).toBe(true);
      expect(isReplayColumn("cacheRead")).toBe(false);
    });
  });
});
