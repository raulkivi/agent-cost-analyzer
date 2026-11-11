// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { priceChangeList } from "../../view-models/increment3-fixtures.js";
import { parsePriceChanges } from "./parse-price-changes.js";

describe("parsePriceChanges", () => {
  it("accepts a get_price_changes result", () => {
    const value = priceChangeList();
    expect(parsePriceChanges(value)).toBe(value);
  });

  it("accepts an empty result", () => {
    expect(parsePriceChanges(priceChangeList({ changes: [] }))).toBeDefined();
  });

  it.each([undefined, null, "text", 3, {}, { changes: [] }, { changes: [], providers: "x" }])("rejects %j", (value) => {
    expect(parsePriceChanges(value)).toBeUndefined();
  });

  it("rejects a change the view could not draw", () => {
    const list = priceChangeList();
    const [documented, observed] = list.changes;
    expect(parsePriceChanges({ ...list, changes: [{ ...documented, changes: undefined }] })).toBeUndefined();
    expect(parsePriceChanges({ ...list, changes: [{ ...observed, weeks: "none" }] })).toBeUndefined();
    expect(parsePriceChanges({ ...list, changes: [{ ...documented, date: 5 }] })).toBeUndefined();
    expect(parsePriceChanges({ ...list, changes: [{ kind: "guess" }] })).toBeUndefined();
    expect(parsePriceChanges({ ...list, changes: [null] })).toBeUndefined();
  });
});
