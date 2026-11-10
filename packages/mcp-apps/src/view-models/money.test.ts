// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { costTotal, usdTotal } from "./cost-analysis-fixtures.js";
import { basisText, formatMoney, formatSignedMoney, formatUnitPrice, moneyViews, perCurrencyViews } from "./money.js";

describe("formatMoney", () => {
  it("writes the unit with every figure", () => {
    expect(formatMoney(142.6, "AI_CREDITS")).toBe("142.60 AI Credits");
    expect(formatMoney(1234.5, "USD")).toBe("$1,234.50");
    expect(formatMoney(0.0123, "USD")).toBe("$0.0123");
    expect(formatMoney(0, "USD")).toBe("$0.00");
  });

  it("signs a change with a typographic minus", () => {
    expect(formatSignedMoney(12.5, "AI_CREDITS")).toBe("+12.50 AI Credits");
    expect(formatSignedMoney(-3, "USD")).toBe("−$3.00");
    expect(formatSignedMoney(0, "USD")).toBe("$0.00");
  });

  it("writes a unit price per 1M tokens, or none", () => {
    expect(formatUnitPrice(3, "USD")).toBe("$3.00 / 1M");
    expect(formatUnitPrice(null, "USD")).toBe("none");
  });
});

describe("basisText", () => {
  it("names each basis; preferred says how it chooses", () => {
    expect(basisText("billed")).toBe("billed");
    expect(basisText("reported")).toBe("reported");
    expect(basisText("priced")).toBe("priced");
    expect(basisText("preferred")).toBe("preferred (billed, else reported, else priced)");
  });
});

describe("moneyViews", () => {
  it("gives one view per currency, each with basis and unit", () => {
    const total = { ...costTotal(10, 4, 5), amounts: [{ currency: "AI_CREDITS" as const, amount: 10, knownTurns: 4 }, { currency: "USD" as const, amount: 2.5, knownTurns: 5 }] };
    const views = moneyViews(total, "billed", "native");
    expect(views.map((view) => view.text)).toEqual(["10.00 AI Credits", "$2.50"]);
    expect(views.every((view) => view.basis === "billed" && view.basisText === "billed")).toBe(true);
    expect(views[0]).toMatchObject({ currency: "AI_CREDITS", amount: 10, known: true, coverageNote: "known for 4 of 5 turns" });
    expect(views[1]?.coverageNote).toBeUndefined();
  });

  it("converts to one USD amount only when the view asks for usd", () => {
    const views = moneyViews(costTotal(100, 10, 10), "priced", "usd");
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ currency: "USD", amount: 1, text: "$1.00" });
  });

  it("reads Unknown for a total with nothing known, never 0", () => {
    const [view] = moneyViews(costTotal(null, 0, 7), "reported", "native");
    expect(view).toMatchObject({ text: "Unknown", amount: null, currency: null, known: false, estimate: false, basis: "reported" });
    expect(view?.unknownNote).toBe("no reported figure for any of 7 turns");
  });

  it("keeps the USD unit on an unknown total in a usd view", () => {
    expect(moneyViews(usdTotal(null, 0, 3), "billed", "usd")[0]).toMatchObject({ currency: "USD", known: false });
  });

  it("carries the estimate tag", () => {
    expect(moneyViews(costTotal(5, 5, 5, { estimated: true }), "priced", "native")[0]?.estimate).toBe(true);
  });
});

describe("perCurrencyViews", () => {
  it("writes per-currency measures with the basis, or Unknown when empty", () => {
    expect(perCurrencyViews([{ currency: "USD", amount: 2 }], "priced", "native")[0]).toMatchObject({ text: "$2.00", basis: "priced", known: true });
    expect(perCurrencyViews([], "priced", "native")[0]).toMatchObject({ text: "Unknown", known: false, amount: null });
  });
});
