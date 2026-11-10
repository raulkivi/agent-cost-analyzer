// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { EXTENSION_NO_PROJECTS_REASON } from "@agent-cost-analyzer/domain";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ViewBrand } from "../brand/view-brand.js";
import type { ToolResult } from "../host/app-host-port.js";
import { FakeAppHostPort } from "../host/fake-app-host-port.js";
import { axeViolations } from "../test-support/axe.js";
import { comparisonChange, comparisonRow, costComparison, costSeries, costTotal, costVariance, point, projectCost, usdTotal, varianceCurrency, varianceModel } from "../view-models/cost-analysis-fixtures.js";
import { costRollup, measures, sessionCost, total, turnSeries } from "../view-models/fixtures.js";
import { turnView } from "../view-models/turn-view-fixture.js";
import { CostChangeView } from "./CostChangeView.js";
import { CostCompareView } from "./CostCompareView.js";
import { CostOverTimeView } from "./CostOverTimeView.js";
import { CostRollupView } from "./CostRollupView.js";
import { FindingsView } from "./FindingsView.js";
import { NoViewState } from "./NoViewState.js";
import { SessionCostView } from "./SessionCostView.js";
import { findingsResult, SAMPLE_FINDINGS } from "./findings/fixtures.js";

// A14 (docs/plans/mcp-apps.md §7): axe-core over every rendered state of
// U1-U3 and the no-view state. Colour contrast is not checked here (jsdom
// has no layout or computed colours); A6's theme-contrast tests cover it.

const brand: ViewBrand = { productId: "vscode-extension", displayName: "AI Credits Analyzer", version: "0.4.0" };

function port(): FakeAppHostPort {
  const fake = new FakeAppHostPort();
  fake.toolResults.set("get_turn_series", { structuredContent: turnSeries() });
  fake.toolResults.set("get_turn", { structuredContent: turnView() });
  fake.toolResults.set("get_session_cost", { structuredContent: sessionCost() });
  return fake;
}

const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
const ok = (structuredContent: unknown): ToolResult => ({ structuredContent });

async function expectNoViolations(): Promise<void> {
  expect(await axeViolations(document.body)).toEqual([]);
}

describe("U1 SessionCostView has no axe violations", () => {
  const renderU1 = (result: ToolResult | undefined, fake = port()) => render(<SessionCostView port={fake} brand={brand} clipboard={clipboard} result={result} />);

  it("loaded", async () => {
    renderU1(ok(sessionCost()));
    await screen.findByRole("img", { name: /AI Credits per turn/ });
    await expectNoViolations();
  });

  it("while the per-turn series loads, and when it fails", async () => {
    const fake = port();
    fake.callTool = () => new Promise(() => undefined);
    const { unmount } = renderU1(ok(sessionCost()), fake);
    await expectNoViolations();
    unmount();
    const failing = port();
    failing.toolResults.delete("get_turn_series");
    renderU1(ok(sessionCost()), failing);
    await screen.findByRole("alert");
    await expectNoViolations();
  });

  it("with a turn expanded", async () => {
    renderU1(ok(sessionCost()));
    fireEvent.click(screen.getByRole("button", { name: /Turn 17/ }));
    await screen.findByText("Turn 17 · claude-sonnet-5.5");
    await expectNoViolations();
  });

  it("with unknown values", async () => {
    const unknown = total(null, 0, 42);
    renderU1(ok(sessionCost({ cacheHitRatio: null as unknown as number, totals: measures(42, { aiCredits: unknown, inputTokens: unknown, output: unknown }) })));
    await screen.findByRole("img", { name: /AI Credits per turn/ });
    await expectNoViolations();
  });

  it("error and waiting", async () => {
    const { unmount } = renderU1({ isError: true });
    await expectNoViolations();
    unmount();
    renderU1(undefined);
    await expectNoViolations();
  });

  it("after the copy button was used", async () => {
    renderU1(ok(sessionCost()));
    fireEvent.click(screen.getByRole("button", { name: "Copy title to open in panel" }));
    await screen.findByRole("button", { name: "Copied" });
    await expectNoViolations();
  });
});

describe("U2 CostRollupView has no axe violations", () => {
  it("loaded", async () => {
    render(<CostRollupView port={port()} brand={brand} result={ok(costRollup())} />);
    await expectNoViolations();
  });

  it("drilled into a session", async () => {
    render(<CostRollupView port={port()} brand={brand} clipboard={clipboard} result={ok(costRollup())} />);
    fireEvent.click(screen.getByRole("button", { name: "Refactor provider registry" }));
    await screen.findByRole("button", { name: "Ask about this session" });
    await screen.findByRole("img", { name: /AI Credits per turn/ });
    await expectNoViolations();
  });

  it("while a drill-down loads, and when it fails", async () => {
    const fake = port();
    fake.toolResults.delete("get_session_cost");
    render(<CostRollupView port={fake} brand={brand} result={ok(costRollup())} />);
    fireEvent.click(screen.getByRole("button", { name: "Refactor provider registry" }));
    await expectNoViolations();
    await screen.findByRole("alert");
    await expectNoViolations();
  });

  it("error and waiting", async () => {
    const { unmount } = render(<CostRollupView port={port()} brand={brand} result={{ isError: true }} />);
    await expectNoViolations();
    unmount();
    render(<CostRollupView port={port()} brand={brand} result={undefined} />);
    await expectNoViolations();
  });
});

describe("U9 CostOverTimeView has no axe violations", () => {
  const weekly = [
    point("2026-W42", "2026-10-12", "2026-10-18", costTotal(26.2, 18, 18), costTotal(26.2, 18, 18)),
    point("2026-W43", "2026-10-19", "2026-10-25", costTotal(null, 0, 0), costTotal(26.2, 18, 18)),
    point("2026-W44", "2026-10-26", "2026-11-01", costTotal(21.8, 11, 18), costTotal(48, 29, 36)),
    point("2026-W45", "2026-11-02", "2026-11-08", costTotal(null, 0, 7), costTotal(48, 29, 43)),
  ];
  const repository = () => costSeries({ bucket: "week", points: weekly, since: "2026-10-12", until: "2026-11-08" });
  const project = () => projectCost({ bucket: "week", points: weekly, since: "2026-10-12", until: "2026-11-08" });
  const renderU9 = (result: ToolResult | undefined, fake = port()) => render(<CostOverTimeView port={fake} brand={brand} clipboard={clipboard} result={result} />);

  it("a repository, with partly known, idle and unknown weeks and both marker kinds", async () => {
    renderU9(ok(repository()));
    await expectNoViolations();
  });

  it("a project, with vendors, tokens and top sessions", async () => {
    renderU9(ok(project()));
    await expectNoViolations();
  });

  it("with two currencies and the switch", async () => {
    const mixed = { ...costTotal(10, 5, 5), amounts: [{ currency: "AI_CREDITS" as const, amount: 10, knownTurns: 5 }, { currency: "USD" as const, amount: 4, knownTurns: 5 }] };
    renderU9(ok(costSeries({ bucket: "week", points: [point("2026-W42", "2026-10-12", "2026-10-18", mixed, mixed)], total: mixed })));
    fireEvent.click(screen.getByRole("radio", { name: "USD" }));
    await expectNoViolations();
  });

  it("drilled into a session, while it loads, and when it fails", async () => {
    const fake = port();
    renderU9(ok(project()), fake);
    fireEvent.click(screen.getByRole("button", { name: "Refactor provider registry" }));
    await expectNoViolations();
    await screen.findByRole("button", { name: "Ask about this session" });
    await screen.findByRole("img", { name: /AI Credits per turn/ });
    await expectNoViolations();
  });

  it("when the drill-down fails", async () => {
    const fake = port();
    fake.toolResults.delete("get_session_cost");
    renderU9(ok(project()), fake);
    fireEvent.click(screen.getByRole("button", { name: "Refactor provider registry" }));
    await screen.findByRole("alert");
    await expectNoViolations();
  });

  it("the no-projects state, a tool error, an unreadable result and waiting", async () => {
    const { unmount } = renderU9({ isError: true, errorText: `Unknown project id "x". Call list_projects to find valid ids. ${EXTENSION_NO_PROJECTS_REASON}` });
    await expectNoViolations();
    unmount();
    const second = renderU9({ isError: true, errorText: "periodB: month must be YYYY-MM" });
    await expectNoViolations();
    second.unmount();
    const third = renderU9({ structuredContent: { nope: 1 } });
    await expectNoViolations();
    third.unmount();
    renderU9(undefined);
    await expectNoViolations();
  });
});

describe("U10 CostCompareView has no axe violations", () => {
  const REASON = EXTENSION_NO_PROJECTS_REASON;
  const answers = (fake = port()) => {
    fake.toolResults.set("get_repository_cost", { structuredContent: costSeries() });
    fake.toolResults.set("get_project_cost", { structuredContent: projectCost() });
    return fake;
  };
  const renderU10 = (result: ToolResult | undefined, fake = answers(), view = brand) => render(<CostCompareView port={fake} brand={view} clipboard={clipboard} result={result} />);
  const mixed = { ...costTotal(449, 300, 300), amounts: [{ currency: "AI_CREDITS" as const, amount: 449, knownTurns: 300 }, { currency: "USD" as const, amount: 21.43, knownTurns: 46 }] };
  const projects = () => costComparison({ groupBy: "project", rows: [comparisonRow({ key: "p1", label: "Provider platform" }), comparisonRow({ key: "p2", label: "Other" })] });

  it("the table, with a change, no earlier figure, a partly known and an unknown row", async () => {
    renderU10(
      ok(
        costComparison({
          rows: [
            comparisonRow({ key: "a", label: "alpha", change: [comparisonChange(100, 80)] }),
            comparisonRow({ key: "b", label: "beta", change: [] }),
            comparisonRow({ key: "c", label: "gamma", total: costTotal(40, 20, 40), change: [comparisonChange(40, 50)] }),
            comparisonRow({ key: "d", label: "delta", total: costTotal(null, 0, 5), change: [], perSession: [], perActiveDay: [], perTurn: [], share: [], cacheHitRatio: null }),
          ],
        }),
      ),
    );
    await expectNoViolations();
  });

  it("with two currencies, and as projects", async () => {
    const { unmount } = renderU10(ok(costComparison({ total: mixed, rows: [comparisonRow({ key: "a", label: "alpha", total: mixed, share: [{ currency: "AI_CREDITS", share: 0.5 }, { currency: "USD", share: 0.4 }] }), comparisonRow({ key: "b", label: "beta", total: usdTotal(36.5, 9, 9) })] })));
    await expectNoViolations();
    unmount();
    renderU10(ok(projects()));
    await expectNoViolations();
  });

  it("the no-projects state, an empty list, a tool error, an unreadable result and waiting", async () => {
    const idle = comparisonRow({ key: "p", label: "p", turns: 0, sessions: 0, previous: { ...comparisonRow().previous, turns: 0, sessions: 0 } });
    const extension: ViewBrand = { ...brand, productId: "vscode-extension" };
    const first = renderU10(ok(costComparison({ groupBy: "project", rows: [idle, idle] })), answers(), extension);
    expect(screen.getByText(REASON)).toBeInTheDocument();
    await expectNoViolations();
    first.unmount();
    const second = renderU10(ok(costComparison({ rows: [] })));
    await expectNoViolations();
    second.unmount();
    const third = renderU10({ isError: true, errorText: "ids: give 2 to 20 ids" });
    await expectNoViolations();
    third.unmount();
    const fourth = renderU10(ok({ nope: 1 }));
    await expectNoViolations();
    fourth.unmount();
    renderU10(undefined);
    await expectNoViolations();
  });

  it("each level of the chain: loading, the project, a session, and back", async () => {
    const fake = answers();
    renderU10(ok(projects()), fake);
    fireEvent.click(screen.getByRole("button", { name: "Provider platform" }));
    await expectNoViolations();
    await screen.findByRole("heading", { name: "Acme platform" });
    await expectNoViolations();
    fireEvent.click(screen.getByRole("button", { name: "Refactor provider registry" }));
    await expectNoViolations();
    await screen.findByRole("button", { name: "Ask about this session" });
    await screen.findByRole("img", { name: /AI Credits per turn/ });
    await expectNoViolations();
    fireEvent.click(screen.getByRole("button", { name: "Back to Acme platform" }));
    await expectNoViolations();
    fireEvent.click(screen.getByRole("button", { name: "Back to comparison" }));
    await expectNoViolations();
  });

  it("a repository drill-down, a failed one, and the extension's no-projects answer", async () => {
    const fake = answers();
    const first = renderU10(ok(costComparison()), fake);
    fireEvent.click(screen.getByRole("button", { name: "widgets" }));
    await screen.findByRole("heading", { name: "widgets" });
    await expectNoViolations();
    first.unmount();

    const failing = answers();
    failing.toolResults.set("get_repository_cost", { isError: true, errorText: "the repository key is no longer in the logs" });
    const second = renderU10(ok(costComparison()), failing);
    fireEvent.click(screen.getByRole("button", { name: "widgets" }));
    await screen.findByRole("alert");
    await expectNoViolations();
    second.unmount();

    const none = answers();
    none.toolResults.set("get_project_cost", { isError: true, errorText: `Unknown project id "p1". Call list_projects to find valid ids. ${REASON}` });
    renderU10(ok(projects()), none);
    fireEvent.click(screen.getByRole("button", { name: "Provider platform" }));
    await screen.findByText(REASON);
    await expectNoViolations();
  });
});

describe("U11 CostChangeView has no axe violations", () => {
  const renderU11 = (result: ToolResult | undefined) => render(<CostChangeView port={port()} brand={brand} result={result} />);
  const usd = varianceCurrency({ currency: "USD", costA: 10, costB: 8, change: -2, usage: -1, price: -1.5, mix: 0.5, models: [varianceModel({ costA: 10, costB: 8, change: -2, usage: -1, price: -1 })] });

  it("loaded, with not-explained turns, a documented price change and the disabled Price changes control", async () => {
    renderU11(ok(costVariance()));
    expect(screen.getByRole("button", { name: "Price changes" })).toBeDisabled();
    await expectNoViolations();
  });

  it("with a model row expanded and the waterfall as a table", async () => {
    renderU11(ok(costVariance()));
    fireEvent.click(screen.getByRole("button", { name: "claude-sonnet-5.5" }));
    for (const button of screen.getAllByRole("button", { name: "View as table" })) fireEvent.click(button);
    await expectNoViolations();
  });

  it("with two currencies, a fall, and logs not fully read", async () => {
    renderU11(ok(costVariance({ currencies: [varianceCurrency(), usd], providers: [{ id: "copilot", label: "Copilot Chat", available: true, sessionCount: 12, truncated: true }] })));
    expect(screen.getByRole("heading", { level: 2, name: "USD" })).toBeInTheDocument();
    await expectNoViolations();
  });

  it("no earlier figure, every turn explained, and no price change", async () => {
    renderU11(ok(costVariance({ currencies: [varianceCurrency({ costA: 0, costB: 5, change: 5, usage: 5, price: 0, mix: 0, models: [] })], notExplained: { periodA: { turns: 0 }, periodB: { turns: 0 } }, priceChanges: [] })));
    await expectNoViolations();
  });

  it("nothing priced in either period", async () => {
    renderU11(ok(costVariance({ currencies: [] })));
    await expectNoViolations();
  });

  it("a tool error with text, one without, an unreadable result and waiting", async () => {
    const first = renderU11({ isError: true, errorText: "periodA: month must be YYYY-MM" });
    await expectNoViolations();
    first.unmount();
    const second = renderU11({ isError: true });
    await expectNoViolations();
    second.unmount();
    const third = renderU11(ok({ nope: 1 }));
    await expectNoViolations();
    third.unmount();
    renderU11(undefined);
    await expectNoViolations();
  });
});

describe("U3 FindingsView has no axe violations", () => {
  const renderU3 = (result: ToolResult | undefined, fake = new FakeAppHostPort()) => render(<FindingsView brand={brand} port={fake} result={result} />);

  it("loaded", async () => {
    renderU3(ok(findingsResult(SAMPLE_FINDINGS, { total: 3 })));
    await expectNoViolations();
  });

  it("with evidence expanded", async () => {
    renderU3(ok(findingsResult(SAMPLE_FINDINGS, { total: 3 })));
    for (const toggle of screen.getAllByRole("button", { name: /Redacted evidence|Why flagged/ })) fireEvent.click(toggle);
    await screen.findByText(/never sent to the chat/);
    await expectNoViolations();
  });

  it("empty", async () => {
    renderU3(ok(findingsResult([], { total: 0, bySeverity: { info: 0, low: 0, medium: 0, high: 0, critical: 0 } })));
    await expectNoViolations();
  });

  it("error, waiting, and a failed refetch", async () => {
    const { unmount } = renderU3({ isError: true });
    await expectNoViolations();
    unmount();
    const { unmount: unmountWaiting } = renderU3(undefined);
    await expectNoViolations();
    unmountWaiting();
    renderU3(ok(findingsResult(SAMPLE_FINDINGS, { total: 3 })));
    fireEvent.click(screen.getByRole("radio", { name: "Security" }));
    await screen.findByRole("alert");
    await expectNoViolations();
  });
});

describe("NoViewState has no axe violations", () => {
  it("renders", async () => {
    render(<NoViewState brand={brand} />);
    await expectNoViolations();
  });
});

// What axe can't see in jsdom: names that say what a chart shows, live
// regions for loading, and the toggles' relationship to what they open.
describe("semantics axe does not check", () => {
  it("each view is one landmark named by its title", () => {
    render(<NoViewState brand={brand} />);
    expect(screen.getByRole("main", { name: "No view for this result" })).toBeInTheDocument();
  });

  it("the per-turn chart's name summarises it, not only its size", async () => {
    render(<SessionCostView port={port()} brand={brand} result={ok(sessionCost())} />);
    expect(await screen.findByRole("img", { name: "AI Credits per turn, 4 turns; highest 4.10 at turn 2; 1 turn unknown" })).toBeInTheDocument();
  });

  it("the daily chart's name summarises it", () => {
    render(<CostRollupView port={port()} brand={brand} result={ok(costRollup())} />);
    expect(screen.getByRole("img", { name: "Daily AI Credits, 3 days; highest 112.60 on Oct 29; 1 day unknown" })).toBeInTheDocument();
  });

  it("announces the chart's loading state", () => {
    const fake = port();
    fake.callTool = () => new Promise(() => undefined);
    render(<SessionCostView port={fake} brand={brand} result={ok(sessionCost())} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading the per-turn chart");
  });

  it("a turn toggle controls the detail row it opens", async () => {
    render(<SessionCostView port={port()} brand={brand} result={ok(sessionCost())} />);
    const toggle = screen.getByRole("button", { name: /Turn 17/ });
    fireEvent.click(toggle);
    await screen.findByText("Turn 17 · claude-sonnet-5.5");
    const controlled = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(controlled).not.toBeNull();
    expect(within(controlled!).getByText("Turn 17 · claude-sonnet-5.5")).toBeInTheDocument();
  });

  it("an evidence toggle controls the region it opens", () => {
    render(<FindingsView brand={brand} port={new FakeAppHostPort()} result={ok(findingsResult(SAMPLE_FINDINGS, { total: 3 }))} />);
    const toggle = screen.getByRole("button", { name: /Redacted evidence/ });
    fireEvent.click(toggle);
    const controlled = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(within(controlled!).getByText(/REDACTED/)).toBeInTheDocument();
  });

  it("every scrolling table container takes keyboard focus and has a name", async () => {
    const { unmount } = render(<FindingsView brand={brand} port={new FakeAppHostPort()} result={ok(findingsResult(SAMPLE_FINDINGS, { total: 3 }))} />);
    const check = () => {
      const scrollers = document.querySelectorAll(".view-scroll, .findings-scroll");
      expect(scrollers.length).toBeGreaterThan(0);
      for (const scroller of scrollers) {
        expect(scroller).toHaveAttribute("tabindex", "0");
        expect(scroller.getAttribute("aria-label")).toBeTruthy();
      }
    };
    check();
    unmount();
    render(<CostRollupView port={port()} brand={brand} result={ok(costRollup())} />);
    check();
  });

  it("the kind filter is a named group of radios", () => {
    render(<FindingsView brand={brand} port={new FakeAppHostPort()} result={ok(findingsResult(SAMPLE_FINDINGS, { total: 3 }))} />);
    const group = screen.getByRole("group", { name: "Kind" });
    expect(within(group).getAllByRole("radio")).toHaveLength(5);
  });

  it("a filter refetch announces itself and an error is an alert", async () => {
    const fake = new FakeAppHostPort();
    render(<FindingsView brand={brand} port={fake} result={ok(findingsResult(SAMPLE_FINDINGS, { total: 3 }))} />);
    fireEvent.click(screen.getByRole("radio", { name: "Security" }));
    expect(screen.getByRole("status")).toHaveTextContent("Loading findings");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load the findings"));
  });
});

// A23: the same checks for U9-U11.
describe("semantics axe does not check, U9-U11", () => {
  const weekly = () =>
    costSeries({
      bucket: "week",
      points: [
        point("2026-W42", "2026-10-12", "2026-10-18", costTotal(26.2, 18, 18), costTotal(26.2, 18, 18)),
        point("2026-W43", "2026-10-19", "2026-10-25", costTotal(21.8, 11, 18), costTotal(48, 29, 36)),
        point("2026-W44", "2026-10-26", "2026-11-01", costTotal(11.2, 30, 30), costTotal(59.2, 59, 66)),
      ],
      since: "2026-10-12",
      until: "2026-11-01",
    });

  it("U11's model toggle controls the token-type row it opens", () => {
    render(<CostChangeView port={port()} brand={brand} result={ok(costVariance())} />);
    const toggle = screen.getByRole("button", { name: "claude-sonnet-5.5" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    const controlled = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(controlled).not.toBeNull();
    expect(within(controlled!).getByRole("table", { name: "claude-sonnet-5.5 by token type" })).toBeInTheDocument();
  });

  it("U11's waterfall key swatches are decorative; the words carry the meaning", () => {
    const { container } = render(<CostChangeView port={port()} brand={brand} result={ok(costVariance())} />);
    const swatches = container.querySelectorAll(".cv-swatch");
    expect(swatches).toHaveLength(3);
    for (const swatch of swatches) expect(swatch).toHaveAttribute("aria-hidden", "true");
  });

  // Decision (A23): the price-change markers stay out of the tab order. The
  // chart's name counts them, and the list below the chart gives each one's
  // model, channel, date and prices as text.
  it("U9's price-change markers are not focusable; the chart's name counts them and the list details them", () => {
    render(<CostOverTimeView port={port()} brand={brand} result={ok(weekly())} />);
    const chart = screen.getByRole("img", { name: /documented price change; 1 inferred price change$/ });
    const markers = chart.querySelectorAll("[data-marker]");
    expect(markers.length).toBeGreaterThan(0);
    for (const marker of markers) expect(marker.closest("[tabindex]")).toBeNull();
    expect(within(screen.getByRole("list", { name: "Price changes in this range" })).getAllByRole("listitem")).toHaveLength(markers.length);
  });

  it("every scrolling table container in U9-U11 takes keyboard focus and has a name", () => {
    const check = () => {
      const scrollers = document.querySelectorAll(".view-scroll");
      expect(scrollers.length).toBeGreaterThan(0);
      for (const scroller of scrollers) {
        expect(scroller).toHaveAttribute("tabindex", "0");
        expect(scroller.getAttribute("aria-label")).toBeTruthy();
      }
    };
    const u9 = render(<CostOverTimeView port={port()} brand={brand} result={ok(projectCost())} />);
    check();
    u9.unmount();
    const u10 = render(<CostCompareView port={port()} brand={brand} result={ok(costComparison())} />);
    check();
    u10.unmount();
    render(<CostChangeView port={port()} brand={brand} result={ok(costVariance())} />);
    fireEvent.click(screen.getByRole("button", { name: "claude-sonnet-5.5" }));
    check();
  });

  it("each waiting state announces itself", () => {
    const u9 = render(<CostOverTimeView port={port()} brand={brand} result={undefined} />);
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for the cost over time");
    u9.unmount();
    const u10 = render(<CostCompareView port={port()} brand={brand} result={undefined} />);
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for the cost comparison");
    u10.unmount();
    render(<CostChangeView port={port()} brand={brand} result={undefined} />);
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for the cost change");
  });
});
