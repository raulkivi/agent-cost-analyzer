import { describe, expect, it } from "vitest";
import {
  ALL_TURN_COLUMNS,
  hiddenTurnColumns,
  parseTurnColumns,
  PRIORITY_TURN_COLUMNS,
  TURN_COLUMNS,
  turnColumnsFor,
} from "./turn-columns.js";

describe("turn columns (§3.5 Layout)", () => {
  it("lists the turns table's 14 columns in display order", () => {
    expect(TURN_COLUMNS.map((column) => column.label)).toEqual([
      "Turn",
      "Trigger",
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

    it("reads nothing usable as no stored choice", () => {
      expect(parseTurnColumns(undefined)).toBeUndefined();
      expect(parseTurnColumns("model")).toBeUndefined();
      expect(parseTurnColumns({ columns: [] })).toBeUndefined();
    });
  });
});
