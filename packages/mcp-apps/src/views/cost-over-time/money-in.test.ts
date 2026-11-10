// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { costTotal, usdTotal } from "../../view-models/cost-analysis-fixtures.js";
import { moneyViews } from "../../view-models/money.js";
import { moneyIn } from "./money-in.js";

const views = (total: ReturnType<typeof costTotal>) => moneyViews(total, "preferred", "native");

describe("moneyIn", () => {
  it("writes the amount of the chosen currency without its unit (the section names it)", () => {
    expect(moneyIn(views(costTotal(249.4, 40, 40)), "AI_CREDITS")).toMatchObject({ text: "249.40", known: true });
    expect(moneyIn(views(usdTotal(21.43, 41, 41)), "USD")).toMatchObject({ text: "$21.43", known: true });
  });

  it("carries the partial-coverage note", () => {
    expect(moneyIn(views(costTotal(18.42, 40, 42)), "AI_CREDITS")).toMatchObject({ coverageNote: "known for 40 of 42 turns" });
  });

  it("is Unknown, never 0, when nothing is known", () => {
    expect(moneyIn(views(costTotal(null, 0, 4)), "AI_CREDITS")).toMatchObject({ text: "Unknown", known: false });
  });

  it("says there is no figure in the chosen currency when only another is known", () => {
    expect(moneyIn(views(usdTotal(3, 4, 4)), "AI_CREDITS")).toMatchObject({ text: "none in AI Credits", known: false });
  });

  it("is Unknown with no currency chosen", () => {
    expect(moneyIn(views(costTotal(null, 0, 4)), null)).toMatchObject({ text: "Unknown", known: false });
  });
});
