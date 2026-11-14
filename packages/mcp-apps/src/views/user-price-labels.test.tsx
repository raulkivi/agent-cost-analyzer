// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ViewBrand } from "../brand/view-brand.js";
import type { ToolResult } from "../host/app-host-port.js";
import { FakeAppHostPort } from "../host/fake-app-host-port.js";
import { axeViolations } from "../test-support/axe.js";
import { comparisonRow, costComparison, costSeries, costTotal, costVariance, projectCost, varianceCurrency } from "../view-models/cost-analysis-fixtures.js";
import { estimate, statement, statementAnswer } from "../view-models/increment3-fixtures.js";
import { claudeRow, row, savingsOutput } from "../view-models/savings-fixtures.js";
import { CostChangeView } from "./CostChangeView.js";
import { CostCompareView } from "./CostCompareView.js";
import { CostOverTimeView } from "./CostOverTimeView.js";
import { EstimateView } from "./EstimateView.js";
import { SavingsView } from "./SavingsView.js";
import { StatementView } from "./StatementView.js";

// 1.0 V2b (threat-model 5.10): "your prices" beside a figure computed with a
// price version the user added, in every chat view that shows a priced figure.
// U1, U2 and U13 show none: U1 and U2 show vendor-billed AI Credits and token
// counts only, and U13 shows price-book changes, not figures priced from the
// user's own versions. Replay (U12) is Simulated and keeps its own label.

const brand: ViewBrand = { productId: "standalone", displayName: "Agent Cost Analyzer", version: "0.14.0" };
const ok = (structuredContent: unknown): ToolResult => ({ structuredContent });
const MINE = ["mine-2026-10"];
const mine = (low: number, high: number) => ({ known: true as const, currency: "AI_CREDITS" as const, low, high, basis: "priced" as const, label: "range" as const, priceVersionIds: MINE, userPriceVersionIds: MINE });
const NAME = "Priced with your own price version: mine-2026-10";
const priced = (credits: number) => ({ ...costTotal(credits, 10, 10), userPriceVersionIds: MINE });
const port = () => new FakeAppHostPort();
const tags = () => screen.queryAllByRole("note", { name: NAME });

describe("U9, U10 cost over time", () => {
  const withPriced = () => {
    const base = projectCost();
    return projectCost({
      totals: { ...base.totals, priced: priced(30), preferred: priced(30) },
      byVendor: base.byVendor.map((vendor) => ({ ...vendor, cost: priced(5) })),
      topSessions: base.topSessions.map((session) => ({ ...session, cost: priced(5) })),
    });
  };

  it("tags the priced and preferred tiles, the vendor rows and the session rows, not the billed or reported tiles", () => {
    render(<CostOverTimeView port={port()} brand={brand} result={ok(withPriced())} />);
    expect(within(screen.getByRole("group", { name: "Priced" })).getByRole("note", { name: NAME })).toHaveTextContent("your prices");
    expect(within(screen.getByRole("group", { name: "Total · preferred basis" })).getByRole("note", { name: NAME })).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Billed" })).queryByRole("note")).toBeNull();
    expect(within(screen.getByRole("group", { name: "Reported" })).queryByRole("note")).toBeNull();
    expect(within(screen.getByRole("table", { name: "Cost by vendor, then model" })).getAllByRole("note", { name: NAME }).length).toBeGreaterThan(0);
  });

  it("shows no tag when no figure used a user price version", () => {
    render(<CostOverTimeView port={port()} brand={brand} result={ok(costSeries())} />);
    expect(screen.queryAllByRole("note")).toEqual([]);
  });

  it("renders a hostile version id inert", () => {
    const hostile = "<img src=x onerror=alert(1)>\u202Eid";
    const total = { ...costTotal(30, 10, 10), userPriceVersionIds: [hostile] };
    const base = costSeries();
    const { container } = render(<CostOverTimeView port={port()} brand={brand} result={ok(costSeries({ totals: { ...base.totals, priced: total } }))} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getAllByRole("note")[0]?.getAttribute("aria-label")).not.toMatch(/\u202E/u);
  });
});

describe("U11 compare", () => {
  it("tags a priced row's total and the grand total, not a billed one", () => {
    const comparison = costComparison({ total: priced(160), rows: [comparisonRow({ key: "a", label: "alpha", total: priced(100) }), comparisonRow({ key: "b", label: "beta" })] });
    render(<CostCompareView port={port()} brand={brand} result={ok(comparison)} />);
    const alpha = screen.getByRole("button", { name: "alpha" }).closest("tr")!;
    const beta = screen.getByRole("button", { name: "beta" }).closest("tr")!;
    expect(within(alpha).getAllByRole("note", { name: NAME }).length).toBeGreaterThan(0);
    expect(within(beta).queryByRole("note")).toBeNull();
    expect(within(screen.getByRole("table").querySelector("tfoot")!).getByRole("note", { name: NAME })).toBeInTheDocument();
  });
});

describe("U11 cost change", () => {
  it("tags the period figures when the variance used a user price version", () => {
    render(<CostChangeView port={port()} brand={brand} result={ok(costVariance({ currencies: [varianceCurrency()], userPriceVersionIds: MINE }))} />);
    expect(tags().length).toBeGreaterThan(0);
  });

  it("shows none otherwise", () => {
    render(<CostChangeView port={port()} brand={brand} result={ok(costVariance())} />);
    expect(screen.queryAllByRole("note")).toEqual([]);
  });
});

describe("U14 statement", () => {
  const answer = () => {
    const base = statement();
    const lines = base.lines.map((line, index) => (index === 0 ? { ...line, userPriced: true as const, priceVersionId: "mine-2026-10" } : line));
    return statementAnswer({ statement: { ...base, lines } });
  };

  it("tags the user-priced line, its currency's total and tile, not the billed lines", () => {
    render(<StatementView port={port()} brand={brand} result={ok(answer())} />);
    const usd = screen.getByRole("region", { name: "Statement lines in USD, scrollable" });
    expect(within(usd).getAllByRole("note", { name: NAME }).length).toBeGreaterThanOrEqual(2);
    expect(within(screen.getByRole("group", { name: "Total, USD" })).getByRole("note", { name: NAME })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Statement lines in AI Credits, scrollable" })).queryByRole("note")).toBeNull();
    expect(within(screen.getByRole("group", { name: "Total, AI Credits" })).queryByRole("note")).toBeNull();
  });

  it("has no axe violations with the tag", async () => {
    const { container } = render(<StatementView port={port()} brand={brand} result={ok(answer())} />);
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("U15 estimate", () => {
  it("tags the range when the estimate used a user price version, not otherwise", () => {
    const { unmount } = render(<EstimateView port={port()} brand={brand} result={ok(estimate({ userPriceVersionIds: MINE }))} />);
    expect(within(screen.getByRole("region", { name: "Estimated range" })).getByRole("note", { name: NAME })).toBeInTheDocument();
    unmount();
    render(<EstimateView port={port()} brand={brand} result={ok(estimate())} />);
    expect(screen.queryAllByRole("note")).toEqual([]);
  });
});

describe("U18 savings", () => {
  it("tags a row whose amounts used a user price version, not a bundled-priced one", () => {
    const user = row({ key: "u", kind: "idle-cache-expiry", subject: "claude-sonnet-5.5", perWeek: mine(1, 2), perWindow: mine(4, 8) });
    render(<SavingsView port={port()} brand={brand} result={ok(savingsOutput({ opportunities: [user, { ...claudeRow, key: "c" }], opportunitiesTotal: 2 }))} />);
    expect(tags()).toHaveLength(1);
  });
});
