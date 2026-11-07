// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  ALL_TURN_COLUMNS,
  columnsApplyingTo,
  hiddenTurnColumns,
  parseTurnColumns,
  PRIORITY_TURN_COLUMNS,
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
    expect(ALL_TURN_COLUMNS).toEqual(TURN_COLUMNS.map((column) => column.id));
  });

  it("names the narrow layout's priority columns: Turn, Trigger, AI Credits, Cumulative", () => {
    expect(PRIORITY_TURN_COLUMNS).toEqual(["turn", "trigger", "aiCredits", "cumulative"]);
  });

  describe("turnColumnsFor", () => {
    it("shows the chosen columns in display order at wide and medium widths", () => {
      expect(turnColumnsFor("wide", ["model", "turn", "aiCredits"])).toEqual(["turn", "aiCredits", "model"]);
      expect(turnColumnsFor("medium", ["model", "turn"])).toEqual(["turn", "model"]);
    });

    it("shows only the priority columns at narrow widths, whatever was chosen", () => {
      expect(turnColumnsFor("narrow", ALL_TURN_COLUMNS)).toEqual(PRIORITY_TURN_COLUMNS);
    });

    it("always keeps the Turn column, which names the row", () => {
      expect(turnColumnsFor("wide", ["model"])).toEqual(["turn", "model"]);
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
    ]);
  });

  describe("parseTurnColumns (a stored choice)", () => {
    it("keeps known column ids, in display order, with Turn", () => {
      expect(parseTurnColumns(["model", "aiCredits"])).toEqual(["turn", "aiCredits", "model"]);
    });

    it("drops unknown ids, e.g. from an older or newer version", () => {
      expect(parseTurnColumns(["model", "gone", 3])).toEqual(["turn", "model"]);
    });

    it("adds the Cache column to an older list that showed every other column", () => {
      const legacy = ALL_TURN_COLUMNS.filter((id) => id !== "cache");
      expect(parseTurnColumns(legacy)).toEqual(ALL_TURN_COLUMNS);
    });

    it("leaves a deliberate older choice without Cache", () => {
      expect(parseTurnColumns(["turn", "model"])).toEqual(["turn", "model"]);
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
  });
});
