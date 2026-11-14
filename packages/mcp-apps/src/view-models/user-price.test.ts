// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { foldVersionId, mergeUserPriceIds, userPriceLabel, USER_PRICE_TEXT } from "./user-price.js";

describe("foldVersionId", () => {
  it("folds control, bidi, zero-width and line-separator characters to single spaces", () => {
    expect(foldVersionId("a\u202Eb\u200Bc\u2028d\ne")).toBe("a b c d e");
  });

  it("caps a long id on whole code points and falls back for an empty one", () => {
    expect(foldVersionId("x".repeat(100))).toHaveLength(60);
    expect(foldVersionId("\u200B\u202E")).toBe("(unnamed)");
    expect([...foldVersionId("\u{1F600}".repeat(80))].every((character) => character === "\u{1F600}")).toBe(true);
  });
});

describe("userPriceLabel", () => {
  it("is undefined for no ids", () => {
    expect(userPriceLabel(undefined)).toBeUndefined();
    expect(userPriceLabel([])).toBeUndefined();
  });

  it("names one or several versions, once each", () => {
    expect(userPriceLabel(["mine-1"])).toEqual({ text: USER_PRICE_TEXT, name: "Priced with your own price version: mine-1" });
    expect(userPriceLabel(["a", "b", "a"])?.name).toBe("Priced with your own price versions: a, b");
  });

  it("lists at most five versions and counts the rest", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g"];
    expect(userPriceLabel(ids)?.name).toBe("Priced with your own price versions: a, b, c, d, e and 2 more");
  });
});

describe("mergeUserPriceIds", () => {
  it("unions and sorts, and is undefined when empty", () => {
    expect(mergeUserPriceIds(["b"], undefined, ["a", "b"])).toEqual(["a", "b"]);
    expect(mergeUserPriceIds(undefined, [])).toBeUndefined();
  });
});
