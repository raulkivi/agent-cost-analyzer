import { describe, expect, it } from "vitest";
import {
  back,
  clearAll,
  clearField,
  commit,
  emptyHistory,
  selectOnly,
  toggleValue,
} from "./selections.js";

describe("selection reducers", () => {
  it("selectOnly replaces the field's selection, and clears it when the value is already the only one", () => {
    expect(selectOnly({ a: ["x", "y"] }, "a", "z")).toEqual({ a: ["z"] });
    expect(selectOnly({ a: ["z"], b: ["q"] }, "a", "z")).toEqual({ b: ["q"] });
  });

  it("toggleValue adds or removes one value and drops an emptied field", () => {
    expect(toggleValue({}, "a", "x")).toEqual({ a: ["x"] });
    expect(toggleValue({ a: ["x"] }, "a", "y")).toEqual({ a: ["x", "y"] });
    expect(toggleValue({ a: ["x"] }, "a", "x")).toEqual({});
  });

  it("clearField and clearAll", () => {
    expect(clearField({ a: ["x"], b: ["y"] }, "a")).toEqual({ b: ["y"] });
    expect(clearAll()).toEqual({});
  });

  it("never mutates the input", () => {
    const before = { a: ["x"] };
    toggleValue(before, "a", "y");
    selectOnly(before, "a", "z");
    clearField(before, "a");
    expect(before).toEqual({ a: ["x"] });
  });
});

describe("selection history", () => {
  it("commits new states and steps back through them", () => {
    let history = emptyHistory();
    history = commit(history, { a: ["x"] });
    history = commit(history, { a: ["x"], b: ["y"] });
    expect(history.present).toEqual({ a: ["x"], b: ["y"] });

    history = back(history);
    expect(history.present).toEqual({ a: ["x"] });
    history = back(history);
    expect(history.present).toEqual({});
    expect(back(history)).toBe(history);
  });

  it("does not record a no-op change", () => {
    const history = commit(emptyHistory(), { a: ["x"] });
    expect(commit(history, { a: ["x"] })).toBe(history);
  });
});
