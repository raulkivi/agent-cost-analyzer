// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { EXTENSION_NO_PROJECTS_REASON } from "@agent-cost-analyzer/domain";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ViewBrand } from "../brand/view-brand.js";
import type { ToolResult } from "../host/app-host-port.js";
import { FakeAppHostPort } from "../host/fake-app-host-port.js";
import { exerciseEveryControl } from "../test-support/exercise-controls.js";
import { costSeries, costTotal, point, projectCost, usdTotal } from "../view-models/cost-analysis-fixtures.js";
import { sessionCost, turnSeries } from "../view-models/fixtures.js";
import { CostOverTimeView } from "./CostOverTimeView.js";

const brand: ViewBrand = { productId: "vscode-extension", displayName: "AI Credits Analyzer", version: "0.4.0" };

const REASON = EXTENSION_NO_PROJECTS_REASON;

// A port whose callTool waits for the test to answer.
class DeferredPort extends FakeAppHostPort {
  private resolvers: ((result: ToolResult) => void)[] = [];
  override callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    this.calls.push({ method: "callTool", args: [name, args] });
    return new Promise((resolve) => this.resolvers.push(resolve));
  }
  answer(result: ToolResult, index = 0): void {
    this.resolvers[index]?.(result);
  }
}

const week = (start: string, end: string, period: string, total: ReturnType<typeof costTotal>) => point(period, start, end, total, total);

const weekly = [
  week("2026-10-12", "2026-10-18", "2026-W42", costTotal(26.2, 18, 18)),
  week("2026-10-19", "2026-10-25", "2026-W43", costTotal(null, 0, 0)),
  week("2026-10-26", "2026-11-01", "2026-W44", costTotal(21.8, 11, 18)),
  week("2026-11-02", "2026-11-08", "2026-W45", costTotal(null, 0, 7)),
];

const weeklySeries = (overrides = {}) => costSeries({ bucket: "week", points: weekly, since: "2026-10-12", until: "2026-11-08", ...overrides });
const weeklyProject = (overrides = {}) => projectCost({ bucket: "week", points: weekly, since: "2026-10-12", until: "2026-11-08", ...overrides });

function setup(options: { structured?: unknown; port?: FakeAppHostPort } = {}) {
  const port = options.port ?? new FakeAppHostPort();
  port.toolResults.set("get_session_cost", { structuredContent: sessionCost() });
  port.toolResults.set("get_turn_series", { structuredContent: turnSeries() });
  const view = render(<CostOverTimeView port={port} brand={brand} result={{ structuredContent: options.structured ?? weeklySeries() }} />);
  return { port, ...view };
}

const calls = (port: FakeAppHostPort, method: string) => port.calls.filter((call) => call.method === method);
const openSession = (title: string) => fireEvent.click(screen.getByRole("button", { name: title }));

describe("CostOverTimeView, repository", () => {
  it("renders the header with the folder name, kicker, period, bucket and pricing, and the footer", () => {
    setup();
    expect(screen.getByRole("heading", { name: "widgets" })).toBeInTheDocument();
    expect(screen.getByText("AI Credits Analyzer · Repository cost")).toBeInTheDocument();
    expect(screen.getByText("repository · Oct 12 – Nov 8 · weekly · prices as of use")).toBeInTheDocument();
    expect(screen.getByText("Read-only · local logs · v0.4.0")).toBeInTheDocument();
  });

  it("shows four basis tiles with their coverage; an empty basis is Unknown with the reason", () => {
    setup();
    const total = screen.getByRole("group", { name: "Total · preferred basis" });
    expect(within(total).getByText("100.00 AI Credits")).toBeInTheDocument();
    expect(within(total).getByText("known for 38 of 46 turns")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Billed" })).getByText("90.00 AI Credits")).toBeInTheDocument();
    const reported = screen.getByRole("group", { name: "Reported" });
    expect(within(reported).getByText("Unknown")).toBeInTheDocument();
    expect(within(reported).getByText("no reported figure for any of 46 turns")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Priced" })).getByText("110.00 AI Credits")).toBeInTheDocument();
  });

  it("says how the preferred basis was made up", () => {
    setup();
    expect(screen.getByText(/Preferred basis takes billed, then reported, then priced: billed for 30 turns, priced for 8, no figure for 8\./)).toBeInTheDocument();
  });

  it("draws known, partly known, idle and unknown weeks apart, and never a zero bar for an unknown", () => {
    setup();
    const chart = screen.getByRole("img", { name: /^Cost per week, AI Credits, 4 weeks; highest Oct 12: 26.20 AI Credits; 1 week partly known; 1 week unknown/ });
    expect(within(chart).getByText("Oct 12: 26.20 AI Credits")).toBeInTheDocument();
    expect(within(chart).getByText("Oct 19: 0 turns", { selector: "title" })).toBeInTheDocument();
    expect(within(chart).getAllByText("Oct 26: 21.80 AI Credits, known for 11 of 18 turns", { selector: "title" }).length).toBeGreaterThan(0);
    expect(within(chart).getByText("Nov 2: Unknown")).toBeInTheDocument();
    expect(chart.querySelectorAll("[data-bar]")).toHaveLength(2);
    expect(chart.querySelectorAll("[data-gap]")).toHaveLength(1);
    expect(chart.querySelectorAll("[data-partial]")).toHaveLength(1);
    expect(chart.querySelectorAll("[data-empty]")).toHaveLength(1);
    expect(within(chart).getByText("0 turns", { selector: "text" })).toBeInTheDocument();
  });

  it("says which weeks are floors, and the turns that sit in no bar", () => {
    setup();
    expect(screen.getByText("1 week is partly known, so its bar is a floor.")).toBeInTheDocument();
    expect(screen.getByText("2 turns have no date and are in no bucket.")).toBeInTheDocument();
  });

  it("draws a documented price change solid and an observed one dashed, hollow and tagged inferred", () => {
    setup();
    const chart = screen.getByRole("img", { name: /1 documented price change; 1 inferred price change/ });
    const documented = chart.querySelector('[data-marker="documented"]')!;
    const observed = chart.querySelector('[data-marker="observed"]')!;
    expect(documented.querySelector("line")?.getAttribute("stroke-dasharray")).toBeNull();
    expect(observed.querySelector("line")?.getAttribute("stroke-dasharray")).toBe("4 3");
    expect(within(observed as SVGElement as unknown as HTMLElement).getByText(/\(inferred\)$/)).toBeInTheDocument();
    expect(within(documented as SVGElement as unknown as HTMLElement).getByText(/\(documented\)$/)).toBeInTheDocument();
  });

  it("lists the price changes with a documented tag and an inferred tag, apart", () => {
    setup();
    const list = screen.getByRole("list", { name: "Price changes in this range" });
    const [documented, observed] = within(list).getAllByRole("listitem");
    expect(within(documented!).getByText("documented")).toBeInTheDocument();
    expect(within(documented!).getByText("input +33.33 %, cache write none to $5.00 / 1M")).toBeInTheDocument();
    expect(within(observed!).getByText("inferred")).toBeInTheDocument();
    expect(within(observed!).getByText(/from the week of Oct 26/)).toBeInTheDocument();
    expect(within(observed!).getByText("billed 12 % above the price book, 2 weeks in a row")).toBeInTheDocument();
  });

  it("has no currency control with one currency, and no vendor, token or session sections for a repository", () => {
    setup();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("switches the chart between the result's currencies, and names the unit", () => {
    const mixed = { ...costTotal(10, 5, 5), amounts: [{ currency: "AI_CREDITS" as const, amount: 10, knownTurns: 5 }, { currency: "USD" as const, amount: 4, knownTurns: 5 }] };
    setup({ structured: weeklySeries({ points: [week("2026-10-12", "2026-10-18", "2026-W42", mixed)], total: mixed }) });
    expect(screen.getByRole("img", { name: /AI Credits, 1 week/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "AI Credits" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "USD" }));
    const chart = screen.getByRole("img", { name: /USD, 1 week; highest Oct 12: \$4.00/ });
    expect(within(chart).getByText("Oct 12: $4.00")).toBeInTheDocument();
    expect(screen.getByText("preferred basis · USD")).toBeInTheDocument();
    expect(screen.getByText(/Currencies are never added together\./)).toBeInTheDocument();
  });

  it("lists AI Credits first and selects it, even when the first week has only USD (§9.1 answer 5)", () => {
    const usdOnly = usdTotal(0.5, 3, 3);
    const mixed = { ...costTotal(10, 5, 5), amounts: [{ currency: "AI_CREDITS" as const, amount: 10, knownTurns: 5 }, { currency: "USD" as const, amount: 4, knownTurns: 5 }] };
    setup({ structured: weeklySeries({ points: [week("2026-10-05", "2026-10-11", "2026-W41", usdOnly), week("2026-10-12", "2026-10-18", "2026-W42", mixed)], total: mixed }) });
    expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("value"))).toEqual(["AI_CREDITS", "USD"]);
    expect(screen.getByRole("radio", { name: "AI Credits" })).toBeChecked();
  });

  it("is a gap with the reason when nothing is known, never 0", () => {
    const none = costTotal(null, 0, 6);
    setup({ structured: weeklySeries({ points: [week("2026-10-12", "2026-10-18", "2026-W42", none)], total: none }) });
    const chart = screen.getByRole("img", { name: /1 week unknown/ });
    expect(chart.querySelectorAll("[data-bar]")).toHaveLength(0);
    expect(within(chart).getByText("Oct 12: Unknown")).toBeInTheDocument();
  });

  it("names the logs that could not be read", () => {
    setup({ structured: weeklySeries({ providers: [{ id: "pi", label: "pi", available: false, unavailableReason: "no logs found", sessionCount: 0, truncated: false }] }) });
    expect(screen.getByRole("list", { name: "Logs not fully read" })).toHaveTextContent("pi: no logs found");
  });

  it("states the conversion only for a usd view", () => {
    setup({ structured: weeklySeries({ currency: "usd" }) });
    expect(screen.getByText(/1 AI Credit = \$0\.01/)).toBeInTheDocument();
  });
});

describe("CostOverTimeView, project", () => {
  it("renders the project's name and the vendor then model split with shares and the unknown vendor's reason", () => {
    setup({ structured: weeklyProject() });
    expect(screen.getByRole("heading", { name: "Acme platform" })).toBeInTheDocument();
    expect(screen.getByText("AI Credits Analyzer · Project cost")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Cost by vendor, then model" });
    const rows = within(table).getAllByRole("row");
    expect(within(rows[1]!).getByText("Anthropic")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("70.00")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("100 %")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("claude-sonnet-5.5")).toBeInTheDocument();
    expect(within(rows[3]!).getByText("Unknown vendor")).toBeInTheDocument();
    expect(within(rows[3]!).getByText("Unknown")).toBeInTheDocument();
    expect(within(rows[3]!).getByText("Reason: model not in the price book (4 turns)")).toBeInTheDocument();
  });

  it("lists tokens by type per model; a type the log lacks is Unknown", () => {
    setup({ structured: weeklyProject() });
    const row = within(screen.getByRole("table", { name: "Tokens by type, per model" })).getAllByRole("row")[1]!;
    expect(within(row).getByText("claude-sonnet-5.5")).toBeInTheDocument();
    expect(within(row).getByText("250 k")).toBeInTheDocument();
    expect(within(row).getByText("Unknown")).toBeInTheDocument();
  });

  it("lists top sessions with model, start, turns, cost and a coverage note", () => {
    setup({ structured: weeklyProject() });
    const table = screen.getByRole("table", { name: "Top sessions by cost" });
    const row = within(table).getAllByRole("row")[1]!;
    expect(within(row).getByRole("button", { name: "Refactor provider registry" })).toBeInTheDocument();
    expect(within(row).getByText("Oct 27")).toBeInTheDocument();
    expect(within(row).getByText("42 turns")).toBeInTheDocument();
    expect(within(row).getByText("18.42")).toBeInTheDocument();
    expect(within(row).getByText("known for 40 of 42 turns")).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "AI Credits" })).toBeInTheDocument();
  });

  it("says so when there are no sessions", () => {
    setup({ structured: weeklyProject({ topSessions: [] }) });
    expect(screen.getByText("No sessions in this period.")).toBeInTheDocument();
  });
});

describe("CostOverTimeView drill-down into U1", () => {
  it("calls get_session_cost with the ids from the view model's drillDown and swaps to the session view in place", async () => {
    const { port } = setup({ structured: weeklyProject() });
    openSession("Refactor provider registry");
    expect(calls(port, "callTool")[0]!.args).toEqual(["get_session_cost", { sessionId: "7f3a9c2e", provider: "copilot" }]);
    expect(await screen.findByRole("heading", { name: "Refactor provider registry" })).toBeInTheDocument();
    expect(screen.getByText("AI Credits Analyzer · Project cost › Session cost")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Input tokens" })).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Top sessions by cost" })).not.toBeInTheDocument();
  });

  it("shows loading while the call is in flight, with Back already there", async () => {
    const port = new DeferredPort();
    setup({ structured: weeklyProject(), port });
    openSession("Refactor provider registry");
    expect(screen.getByRole("status")).toHaveTextContent("Loading session");
    expect(screen.getByRole("button", { name: "Back to cost over time" })).toBeInTheDocument();
    await act(async () => port.answer({ structuredContent: sessionCost() }));
    expect(await screen.findByRole("group", { name: "Input tokens" })).toBeInTheDocument();
  });

  it("goes back without fetching again, keeps the chosen currency, and returns focus to the session's button", async () => {
    const { port } = setup({ structured: weeklyProject() });
    openSession("Refactor provider registry");
    await screen.findByRole("group", { name: "Input tokens" });
    await screen.findByRole("img", { name: /AI Credits per turn/ });
    const before = calls(port, "callTool").length;
    fireEvent.click(screen.getByRole("button", { name: "Back to cost over time" }));
    expect(screen.getByRole("table", { name: "Top sessions by cost" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /^Cost per week/ })).toBeInTheDocument();
    expect(calls(port, "callTool")).toHaveLength(before);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Refactor provider registry" })));
  });

  it("shows an error with Back and Retry when the call fails, and Retry recovers", async () => {
    const port = new FakeAppHostPort();
    setup({ structured: weeklyProject(), port });
    port.toolResults.set("get_session_cost", { isError: true });
    openSession("Refactor provider registry");
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load this session.");
    expect(screen.getByRole("alert")).toHaveTextContent("Go back to cost over time, or retry.");
    expect(screen.getByRole("button", { name: "Back to cost over time" })).toBeInTheDocument();
    port.toolResults.set("get_session_cost", { structuredContent: sessionCost() });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("group", { name: "Input tokens" })).toBeInTheDocument();
  });

  it("treats a rejected call as an error and can still go back", async () => {
    const port = new FakeAppHostPort();
    setup({ structured: weeklyProject(), port });
    port.callTool = () => Promise.reject(new Error("host gone"));
    openSession("Refactor provider registry");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to cost over time" }));
    expect(screen.getByRole("table", { name: "Top sessions by cost" })).toBeInTheDocument();
  });
});

describe("CostOverTimeView states", () => {
  const renderWith = (result: ToolResult | undefined) => render(<CostOverTimeView port={new FakeAppHostPort()} brand={brand} result={result} />);

  it("waits for the result", () => {
    renderWith(undefined);
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for the cost over time");
  });

  it("explains the extension's no-projects answer in place of a chart, with the reason as plain text", () => {
    renderWith({ isError: true, errorText: `Unknown project id "provider-platform". Call list_projects to find valid ids. ${REASON}` });
    expect(screen.getByRole("heading", { name: "No projects here" })).toBeInTheDocument();
    expect(screen.getByText("AI Credits Analyzer · Project cost")).toBeInTheDocument();
    expect(screen.getByText(REASON)).toBeInTheDocument();
    expect(screen.getByText(/Cost by repository works as usual/)).toBeInTheDocument();
    expect(screen.getByText('Unknown project id "provider-platform"')).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows another tool error's text, never an empty chart", () => {
    renderWith({ isError: true, errorText: 'Unknown project id "nope". Call list_projects to find valid ids.' });
    expect(screen.getByRole("alert")).toHaveTextContent('Couldn\'t load the cost over time. The tool returned an error: Unknown project id "nope". Call list_projects to find valid ids.');
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows an error with no text when the host gave none, and for an unreadable result", () => {
    const { unmount } = renderWith({ isError: true });
    expect(screen.getByRole("alert")).toHaveTextContent("The tool returned an error. The text answer above is complete.");
    unmount();
    renderWith({ structuredContent: { nope: 1 } });
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load the cost over time.");
  });

  it("renders error text as text, not markup", () => {
    const { container } = renderWith({ isError: true, errorText: "<img src=x onerror=alert(1)><b>bold</b>" });
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelectorAll("b")).toHaveLength(1); // the error box's own title
    expect(screen.getByRole("alert")).toHaveTextContent("<img src=x onerror=alert(1)><b>bold</b>");
  });
});

describe("CostOverTimeView security", () => {
  it("presses every control and sends nothing but get_session_cost, with ids only", async () => {
    const { port } = setup({ structured: weeklyProject() });
    const pressed = await exerciseEveryControl(document.body);
    expect(pressed).toContain("button:Refactor provider registry");
    const calledTools = new Set(calls(port, "callTool").map((call) => call.args[0]));
    expect([...calledTools].every((name) => ["get_session_cost", "get_turn_series", "get_turn"].includes(name as string))).toBe(true);
    expect(calls(port, "callTool").filter((call) => call.args[0] === "get_session_cost").every((call) => JSON.stringify(call.args[1]) === JSON.stringify({ sessionId: "7f3a9c2e", provider: "copilot" }))).toBe(true);
    expect(calls(port, "openLink")).toHaveLength(0);
    // The one message, "Ask about this session", names the id only.
    for (const call of calls(port, "sendMessage")) expect(call.args[0]).toBe("Analyse session 7f3a9c2e");
    expect(JSON.stringify(port.calls)).not.toContain("Refactor provider registry");
  });

  it("sends nothing at all from the repository view", async () => {
    const { port } = setup({ structured: weeklySeries() });
    await exerciseEveryControl(document.body);
    expect(port.calls.filter((call) => call.method !== "connect")).toEqual([]);
  });
});

// A21: U10 opens U9 in place and hands it a frame, so U9's own drill-down into
// U1 carries the kicker trail and a Back to U9 beside it.
describe("CostOverTimeView in a frame (U10 chain)", () => {
  const frame = { kicker: "Cost comparison", trail: ["Cost comparison", "Acme platform"], lead: () => <button type="button">Back to comparison</button> };
  const renderFramed = (structured: unknown = weeklyProject(), port = new FakeAppHostPort()) => {
    port.toolResults.set("get_session_cost", { structuredContent: sessionCost() });
    port.toolResults.set("get_turn_series", { structuredContent: turnSeries() });
    render(<CostOverTimeView port={port} brand={brand} result={{ structuredContent: structured }} frame={frame} />);
    return port;
  };

  it("puts the frame's kicker before its own and its lead above the title", () => {
    renderFramed();
    expect(screen.getByText("AI Credits Analyzer · Cost comparison › Project cost")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to comparison" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Acme platform" })).toBeInTheDocument();
  });

  it("uses the repository kicker for a repository", () => {
    renderFramed(weeklySeries());
    expect(screen.getByText("AI Credits Analyzer · Cost comparison › Repository cost")).toBeInTheDocument();
  });

  it("opens a session under the full trail, with Back to this view beside the trail", async () => {
    renderFramed();
    openSession("Refactor provider registry");
    await screen.findByRole("group", { name: "Input tokens" });
    expect(screen.getByText("AI Credits Analyzer · Cost comparison › Project cost › Session cost")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to Acme platform" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back to comparison" })).not.toBeInTheDocument();
    expect(screen.getByText("Cost comparison / Acme platform / Refactor provider registry")).toBeInTheDocument();
  });

  it("goes back one level to the project view without fetching again", async () => {
    const port = renderFramed();
    openSession("Refactor provider registry");
    await screen.findByRole("group", { name: "Input tokens" });
    await screen.findByRole("img", { name: /AI Credits per turn/ });
    const before = calls(port, "callTool").length;
    fireEvent.click(screen.getByRole("button", { name: "Back to Acme platform" }));
    expect(screen.getByRole("table", { name: "Top sessions by cost" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to comparison" })).toBeInTheDocument();
    expect(calls(port, "callTool")).toHaveLength(before);
  });

  it("shows no trail line when it is not in a frame", async () => {
    setup({ structured: weeklyProject() });
    openSession("Refactor provider registry");
    await screen.findByRole("group", { name: "Input tokens" });
    expect(screen.queryByText(/ \/ /)).not.toBeInTheDocument();
  });
});
