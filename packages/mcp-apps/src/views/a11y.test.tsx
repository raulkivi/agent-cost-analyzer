// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ViewBrand } from "../brand/view-brand.js";
import type { ToolResult } from "../host/app-host-port.js";
import { FakeAppHostPort } from "../host/fake-app-host-port.js";
import { axeViolations } from "../test-support/axe.js";
import { costRollup, measures, sessionCost, total, turnSeries } from "../view-models/fixtures.js";
import { turnView } from "../view-models/turn-view-fixture.js";
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
    fireEvent.click(screen.getByRole("button", { name: /Copy .open in panel. command/ }));
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
