// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CostComparison } from "@agent-cost-analyzer/domain";
import type { ViewBrand } from "../brand/view-brand.js";
import type { ToolResult } from "../host/app-host-port.js";
import { FakeAppHostPort } from "../host/fake-app-host-port.js";
import { exerciseEveryControl } from "../test-support/exercise-controls.js";
import { comparisonChange, comparisonRow, costComparison, costSeries, costTotal, projectCost, usdTotal } from "../view-models/cost-analysis-fixtures.js";
import { sessionCost, turnSeries } from "../view-models/fixtures.js";
import { CostCompareView } from "./CostCompareView.js";

const brand: ViewBrand = { productId: "standalone", displayName: "Agent Cost Analyzer", version: "0.11.0" };
const extensionBrand: ViewBrand = { productId: "vscode-extension", displayName: "AI Credits Analyzer", version: "0.4.0" };

const REASON = "AI Credits Analyzer has no projects: projects are edited in the standalone Agent Cost Analyzer app. Every turn is in No project; repositories are listed as usual.";

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

const calls = (port: FakeAppHostPort, method: string) => port.calls.filter((call) => call.method === method);
const toolCalls = (port: FakeAppHostPort) => calls(port, "callTool").map((call) => call.args);

// Four rows as the board has them: up, down, no earlier figure, partly known.
function fourRows(): CostComparison {
  return costComparison({
    since: "2026-08-03",
    until: "2026-11-01",
    previousSince: "2026-05-04",
    previousUntil: "2026-08-02",
    total: costTotal(952, 951, 952),
    rows: [
      comparisonRow({
        key: "github.com/acme/provider-core",
        label: "provider-core",
        sessions: 38,
        turns: 346,
        total: costTotal(449, 346, 346),
        change: [comparisonChange(449, 380.2, 0.181)],
        perSession: [{ currency: "AI_CREDITS", amount: 11.82 }],
        perActiveDay: [{ currency: "AI_CREDITS", amount: 10.95 }],
        perTurn: [{ currency: "AI_CREDITS", amount: 1.3 }],
        share: [{ currency: "AI_CREDITS", share: 0.472 }],
        cacheHitRatio: 0.71,
      }),
      comparisonRow({
        key: "github.com/acme/checkout-web",
        label: "checkout-web",
        sessions: 29,
        turns: 262,
        total: costTotal(312, 262, 262),
        change: [comparisonChange(312, 345.6, -0.097)],
        share: [{ currency: "AI_CREDITS", share: 0.328 }],
        cacheHitRatio: 0.64,
      }),
      comparisonRow({
        key: "github.com/acme/infra-scripts",
        label: "infra-scripts",
        sessions: 12,
        turns: 97,
        total: costTotal(149.8, 97, 97),
        change: [],
        share: [{ currency: "AI_CREDITS", share: 0.157 }],
        cacheHitRatio: 0.58,
      }),
      comparisonRow({
        key: "github.com/acme/docs-site",
        label: "docs-site",
        sessions: 9,
        turns: 44,
        total: costTotal(41.2, 31, 44),
        change: [comparisonChange(41.2, 52, -0.208)],
        share: [{ currency: "AI_CREDITS", share: 0.043 }],
        cacheHitRatio: 0.49,
      }),
    ],
  });
}

const TOOL_ANSWERS = (port: FakeAppHostPort) => {
  port.toolResults.set("get_repository_cost", { structuredContent: costSeries() });
  port.toolResults.set("get_project_cost", { structuredContent: projectCost() });
  port.toolResults.set("get_session_cost", { structuredContent: sessionCost() });
  port.toolResults.set("get_turn_series", { structuredContent: turnSeries() });
};

function setup(options: { structured?: unknown; port?: FakeAppHostPort; brand?: ViewBrand } = {}) {
  const port = options.port ?? new FakeAppHostPort();
  if (options.port === undefined) TOOL_ANSWERS(port);
  const view = render(<CostCompareView port={port} brand={options.brand ?? brand} result={{ structuredContent: options.structured ?? fourRows() }} />);
  return { port, ...view };
}

const rowOf = (name: string): HTMLElement => screen.getByRole("button", { name }).closest("tr")!;

describe("CostCompareView, the table", () => {
  it("renders the header, kicker, periods, pricing and footer", () => {
    setup();
    expect(screen.getByRole("heading", { name: "4 repositories compared" })).toBeInTheDocument();
    expect(screen.getByText("Agent Cost Analyzer · Cost comparison")).toBeInTheDocument();
    expect(screen.getByText("Aug 3 – Nov 1 vs May 4 – Aug 2 (previous period) · prices as of use")).toBeInTheDocument();
    expect(screen.getByText("Read-only · local logs · v0.11.0")).toBeInTheDocument();
  });

  it("says what the money is and which basis, and what cache hit means", () => {
    setup();
    expect(screen.getByText(/All money in AI Credits on the preferred basis: billed, then reported, then priced\./)).toBeInTheDocument();
    expect(screen.getByText(/Cache hit is cache-read tokens over input tokens\./)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cost by repository" })).toBeInTheDocument();
  });

  it("lists the rows most expensive first, with sessions and turns", () => {
    setup();
    const table = screen.getByRole("table", { name: "Cost by repository" });
    const names = within(table)
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(names).toEqual(["provider-core", "checkout-web", "infra-scripts", "docs-site"]);
    expect(within(rowOf("provider-core")).getByText("38 sessions · 346 turns")).toBeInTheDocument();
  });

  it("shows the total with its share and a share bar that is not the only carrier of the figure", () => {
    setup();
    const row = rowOf("provider-core");
    expect(within(row).getByText("449.00")).toBeInTheDocument();
    expect(within(row).getByText("47.2 %")).toBeInTheDocument();
    expect(row.querySelector("[data-bar]")).not.toBeNull();
  });

  it("shows a signed change with its percent, and an arrow that is never the only sign", () => {
    setup();
    expect(within(rowOf("provider-core")).getByText("+18.1 %")).toBeInTheDocument();
    expect(within(rowOf("provider-core")).getByText(/^\+/, { selector: ".cc-change-abs" })).toBeInTheDocument();
    expect(within(rowOf("checkout-web")).getByText("−9.7 %")).toBeInTheDocument();
    expect(within(rowOf("checkout-web")).getByText(/^−/, { selector: ".cc-change-abs" })).toBeInTheDocument();
  });

  it("says no earlier figure for a row without one, never a change from 0", () => {
    setup();
    expect(within(rowOf("infra-scripts")).getByText("no earlier figure")).toBeInTheDocument();
    expect(screen.queryByText(/from 0/i)).not.toBeInTheDocument();
    expect(within(rowOf("infra-scripts")).queryByText(/%/, { selector: ".cc-change-pct" })).not.toBeInTheDocument();
  });

  it("shows per session, per active day, per turn and the cache-hit ratio", () => {
    setup();
    const row = rowOf("provider-core");
    for (const text of ["11.82", "10.95", "1.30", "71 %"]) expect(within(row).getAllByText(text).length).toBeGreaterThan(0);
    const headers = within(screen.getByRole("table", { name: "Cost by repository" }))
      .getAllByRole("columnheader")
      .map((header) => header.textContent);
    expect(headers).toEqual(["Repository", "Total", "Change", "Per session", "Per active day", "Per turn", "Cache hit"]);
  });

  it("tags a partly known total with its coverage", () => {
    setup();
    expect(within(rowOf("docs-site")).getByText("known for 31 of 44 turns")).toBeInTheDocument();
    expect(within(rowOf("provider-core")).queryByText(/known for/)).not.toBeInTheDocument();
  });

  it("has a Together row with the total only", () => {
    setup();
    const table = screen.getByRole("table", { name: "Cost by repository" });
    const together = within(table).getByRole("rowheader", { name: "Together" }).closest("tr")!;
    expect(within(together).getByText("952.00")).toBeInTheDocument();
    expect(within(together).queryByText(/%/)).not.toBeInTheDocument();
    expect(within(together).queryByRole("button")).not.toBeInTheDocument();
  });

  it("is Unknown, never 0, for a row with nothing known", () => {
    const rows = [comparisonRow({ key: "a", label: "alpha", total: costTotal(null, 0, 5), change: [], perSession: [], perActiveDay: [], perTurn: [], share: [], cacheHitRatio: null }), comparisonRow({ key: "b", label: "beta", total: costTotal(10, 5, 5) })];
    setup({ structured: costComparison({ rows }) });
    const row = rowOf("alpha");
    expect(within(row).getAllByText("Unknown").length).toBeGreaterThan(0);
    expect(within(row).queryByText("0.00")).not.toBeInTheDocument();
  });

  it("states the conversion only for a usd view, and the logs that could not be read", () => {
    setup({ structured: costComparison({ currency: "usd", conversion: "1 AI Credit = $0.01 (GitHub's documented rate); no other exchange rate is used.", providers: [{ id: "copilot", label: "Copilot Chat", available: false, sessionCount: 0, truncated: false, unavailableReason: "no log folder" }] }) });
    expect(screen.getByText(/1 AI Credit = \$0\.01/)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Logs not fully read" })).toHaveTextContent("Copilot Chat: no log folder");
  });

  it("says how many turns have no date", () => {
    setup({ structured: costComparison({ undatedTurns: 2 }) });
    expect(screen.getByText("2 turns have no date and are in neither period.")).toBeInTheDocument();
  });

  it("names a comparison of projects by project", () => {
    setup({ structured: costComparison({ groupBy: "project", rows: [comparisonRow({ key: "p1", label: "Provider platform" }), comparisonRow({ key: "p2", label: "Checkout rework" })] }) });
    expect(screen.getByRole("heading", { name: "2 projects compared" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Cost by project" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Project" })).toBeInTheDocument();
  });
});

describe("CostCompareView, mixed currencies", () => {
  const mixed = () =>
    costComparison({
      total: { ...costTotal(761, 600, 700), amounts: [{ currency: "AI_CREDITS", amount: 761, knownTurns: 600 }, { currency: "USD", amount: 57.93, knownTurns: 100 }] },
      rows: [
        comparisonRow({
          key: "a",
          label: "provider-core",
          total: { ...costTotal(449, 300, 300), amounts: [{ currency: "AI_CREDITS", amount: 449, knownTurns: 300 }, { currency: "USD", amount: 21.43, knownTurns: 46 }] },
          change: [comparisonChange(449, 380.2, 0.181), { ...comparisonChange(21.43, 18.1, 0.184), currency: "USD" }],
          perSession: [{ currency: "AI_CREDITS", amount: 11.82 }, { currency: "USD", amount: 0.56 }],
          share: [{ currency: "AI_CREDITS", share: 0.59 }, { currency: "USD", share: 0.37 }],
        }),
        comparisonRow({ key: "c", label: "infra-scripts", total: usdTotal(36.5, 97, 97), change: [], perSession: [{ currency: "USD", amount: 3.04 }], share: [{ currency: "USD", share: 0.63 }] }),
      ],
    });

  it("keeps AI Credits and USD on lines of their own, USD with a dollar sign, never added", () => {
    setup({ structured: mixed() });
    const row = rowOf("provider-core");
    expect(within(row).getByText("449.00")).toBeInTheDocument();
    expect(within(row).getByText("$21.43")).toBeInTheDocument();
    expect(within(row).getByText("59.0 %")).toBeInTheDocument();
    expect(within(row).getByText("37.0 %")).toBeInTheDocument();
    expect(within(row).getByText("+18.1 %")).toBeInTheDocument();
    expect(within(row).getByText("+18.4 %")).toBeInTheDocument();
    expect(within(rowOf("infra-scripts")).getByText("$36.50")).toBeInTheDocument();
    expect(screen.queryByText(/810/)).not.toBeInTheDocument();
  });

  it("explains the two currencies and gives Together one total per currency", () => {
    setup({ structured: mixed() });
    expect(screen.getByText(/costs in two currencies/)).toBeInTheDocument();
    const together = screen.getByRole("rowheader", { name: "Together" }).closest("tr")!;
    expect(within(together).getByText("761.00")).toBeInTheDocument();
    expect(within(together).getByText("$57.93")).toBeInTheDocument();
    expect(screen.queryByText(/All money in AI Credits on/)).not.toBeInTheDocument();
  });
});

describe("CostCompareView, states", () => {
  it("waits for the result", () => {
    render(<CostCompareView port={new FakeAppHostPort()} brand={brand} result={undefined} />);
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for the cost comparison");
  });

  it("shows a tool error's text as plain text, never an empty table", () => {
    render(<CostCompareView port={new FakeAppHostPort()} brand={brand} result={{ isError: true, errorText: "ids: give 2 to 20 ids <b>x</b>" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("ids: give 2 to 20 ids <b>x</b>");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows an error with no text, and one for an unreadable result", () => {
    const { unmount } = render(<CostCompareView port={new FakeAppHostPort()} brand={brand} result={{ isError: true }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The tool returned an error");
    unmount();
    render(<CostCompareView port={new FakeAppHostPort()} brand={brand} result={{ structuredContent: { nope: 1 } }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("can't read");
  });

  it("shows the product's no-projects state in the extension when no project has a turn, not an empty table", () => {
    const idle = (key: string, label: string) => comparisonRow({ key, label, sessions: 0, turns: 0, total: costTotal(null, 0, 0), change: [], share: [], perSession: [], perActiveDay: [], perTurn: [], cacheHitRatio: null, previous: { ...comparisonRow().previous, turns: 0, sessions: 0 } });
    setup({ brand: extensionBrand, structured: costComparison({ groupBy: "project", rows: [idle("p1", "p1"), idle("p2", "p2")] }) });
    expect(screen.getByRole("heading", { name: "No projects here" })).toBeInTheDocument();
    expect(screen.getByText(REASON)).toBeInTheDocument();
    expect(screen.getByText(/ask for a repository's cost, or compare repositories/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows the no-projects state for an empty project list in any product", () => {
    setup({ structured: costComparison({ groupBy: "project", rows: [] }) });
    expect(screen.getByRole("heading", { name: "No projects here" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("keeps the table for idle projects in the standalone app, where Unknown is true", () => {
    const idle = comparisonRow({ key: "p1", label: "Quiet project", sessions: 0, turns: 0, total: costTotal(null, 0, 0), change: [], share: [], previous: { ...comparisonRow().previous, turns: 0, sessions: 0 } });
    setup({ structured: costComparison({ groupBy: "project", rows: [idle, comparisonRow({ key: "p2", label: "Other", turns: 0, sessions: 0, previous: { ...comparisonRow().previous, turns: 0, sessions: 0 } })] }) });
    expect(screen.getByRole("table", { name: "Cost by project" })).toBeInTheDocument();
  });

  it("says there is nothing to compare for an empty repository list", () => {
    setup({ structured: costComparison({ rows: [] }) });
    expect(screen.getByRole("heading", { name: "Nothing to compare" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("CostCompareView drill-down into U9", () => {
  it("calls get_repository_cost with exactly the row's drillDown arguments and renders U9 in place", async () => {
    const { port } = setup();
    fireEvent.click(screen.getByRole("button", { name: "provider-core" }));
    expect(toolCalls(port)).toEqual([
      [
        "get_repository_cost",
        { repository: "github.com/acme/provider-core", since: "2026-08-03", until: "2026-11-01", basis: "preferred", pricing: "as-of-use", currency: "native" },
      ],
    ]);
    expect(await screen.findByRole("heading", { name: "widgets" })).toBeInTheDocument();
    expect(screen.getByText("Agent Cost Analyzer · Cost comparison › Repository cost")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to comparison" })).toBeInTheDocument();
    expect(screen.getByText("Cost comparison / provider-core")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Cost by repository" })).not.toBeInTheDocument();
  });

  it("calls get_project_cost with the project id for a project row", async () => {
    const structured = costComparison({ groupBy: "project", rows: [comparisonRow({ key: "p1", label: "Provider platform" }), comparisonRow({ key: "p2", label: "Checkout rework" })] });
    const { port } = setup({ structured });
    fireEvent.click(screen.getByRole("button", { name: "Provider platform" }));
    expect(toolCalls(port)).toEqual([["get_project_cost", { projectId: "p1", since: "2026-11-01", until: "2026-11-09", basis: "preferred", pricing: "as-of-use", currency: "native" }]]);
    expect(await screen.findByRole("heading", { name: "Acme platform" })).toBeInTheDocument();
    expect(screen.getByText("Agent Cost Analyzer · Cost comparison › Project cost")).toBeInTheDocument();
  });

  it("passes a usd view's arguments on as they came", async () => {
    const { port } = setup({ structured: costComparison({ currency: "usd", basis: "billed", pricing: "today", rows: [comparisonRow({ key: "r1", label: "one" }), comparisonRow({ key: "r2", label: "two" })] }) });
    fireEvent.click(screen.getByRole("button", { name: "one" }));
    expect(toolCalls(port)[0]).toEqual(["get_repository_cost", { repository: "r1", since: "2026-11-01", until: "2026-11-09", basis: "billed", pricing: "today", currency: "usd" }]);
  });

  it("shows loading while the call is in flight, with Back already there", async () => {
    const port = new DeferredPort();
    setup({ port });
    fireEvent.click(screen.getByRole("button", { name: "provider-core" }));
    expect(screen.getByRole("status")).toHaveTextContent("Loading provider-core");
    expect(screen.getByRole("button", { name: "Back to comparison" })).toBeInTheDocument();
    await act(async () => port.answer({ structuredContent: costSeries() }));
    expect(await screen.findByRole("heading", { name: "widgets" })).toBeInTheDocument();
  });

  it("goes back without fetching again, and returns focus to the row", async () => {
    const { port } = setup();
    fireEvent.click(screen.getByRole("button", { name: "checkout-web" }));
    await screen.findByRole("heading", { name: "widgets" });
    const before = toolCalls(port).length;
    fireEvent.click(screen.getByRole("button", { name: "Back to comparison" }));
    expect(screen.getByRole("table", { name: "Cost by repository" })).toBeInTheDocument();
    expect(toolCalls(port)).toHaveLength(before);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "checkout-web" })));
  });

  it("shows the tool's error text as plain text, keeps Back, and Retry recovers", async () => {
    const port = new FakeAppHostPort();
    TOOL_ANSWERS(port);
    port.toolResults.set("get_repository_cost", { isError: true, errorText: "the repository key is no longer in the logs <i>x</i>" });
    setup({ port });
    fireEvent.click(screen.getByRole("button", { name: "provider-core" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't open provider-core.");
    expect(alert).toHaveTextContent("get_repository_cost returned an error: the repository key is no longer in the logs <i>x</i>");
    expect(alert.querySelector("i")).toBeNull();
    expect(screen.getByRole("button", { name: "Back to comparison" })).toBeInTheDocument();
    port.toolResults.set("get_repository_cost", { structuredContent: costSeries() });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "widgets" })).toBeInTheDocument();
    expect(toolCalls(port).filter(([name]) => name === "get_repository_cost")).toHaveLength(2);
  });

  it("treats a rejected call and an unreadable answer as errors, and can still go back", async () => {
    const port = new FakeAppHostPort();
    TOOL_ANSWERS(port);
    port.toolResults.delete("get_repository_cost");
    setup({ port });
    fireEvent.click(screen.getByRole("button", { name: "provider-core" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't open provider-core.");
    fireEvent.click(screen.getByRole("button", { name: "Back to comparison" }));
    port.toolResults.set("get_repository_cost", { structuredContent: { nope: 1 } });
    fireEvent.click(screen.getByRole("button", { name: "provider-core" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't open provider-core.");
  });

  it("puts the extension's no-projects reason in place of the project view", async () => {
    const port = new FakeAppHostPort();
    TOOL_ANSWERS(port);
    port.toolResults.set("get_project_cost", { isError: true, errorText: `Unknown project id "p1". Call list_projects to find valid ids. ${REASON}` });
    const structured = costComparison({ groupBy: "project", rows: [comparisonRow({ key: "p1", label: "Provider platform" }), comparisonRow({ key: "p2", label: "Other" })] });
    setup({ port, structured });
    fireEvent.click(screen.getByRole("button", { name: "Provider platform" }));
    expect(await screen.findByText(REASON)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to comparison" })).toBeInTheDocument();
  });

  it("goes U10 to U9 to U1 and back one level at a time, with the trail", async () => {
    const structured = costComparison({ groupBy: "project", rows: [comparisonRow({ key: "p1", label: "Provider platform" }), comparisonRow({ key: "p2", label: "Other" })] });
    const { port } = setup({ structured });
    fireEvent.click(screen.getByRole("button", { name: "Provider platform" }));
    await screen.findByRole("heading", { name: "Acme platform" });
    fireEvent.click(screen.getByRole("button", { name: "Refactor provider registry" }));
    await screen.findByRole("group", { name: "Input tokens" });
    expect(screen.getByText("Agent Cost Analyzer · Cost comparison › Project cost › Session cost")).toBeInTheDocument();
    expect(screen.getByText("Cost comparison / Provider platform / Refactor provider registry")).toBeInTheDocument();
    expect(toolCalls(port).map(([name]) => name)).toContain("get_session_cost");

    await screen.findByRole("img", { name: /AI Credits per turn/ });
    const before = toolCalls(port).length;
    fireEvent.click(screen.getByRole("button", { name: "Back to Acme platform" }));
    expect(screen.getByRole("table", { name: "Top sessions by cost" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to comparison" }));
    expect(screen.getByRole("table", { name: "Cost by project" })).toBeInTheDocument();
    expect(toolCalls(port)).toHaveLength(before);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Provider platform" })));
  });
});

describe("CostCompareView security", () => {
  it("presses every control and sends only the reviewed tools with ids, periods and the basis", async () => {
    const structured = costComparison({ groupBy: "project", rows: [comparisonRow({ key: "p1", label: "Provider platform" }), comparisonRow({ key: "p2", label: "Other" })] });
    const { port } = setup({ structured });
    const pressed = await exerciseEveryControl(document.body);
    expect(pressed).toContain("button:Provider platform");
    const allowed = ["get_project_cost", "get_session_cost", "get_turn_series", "get_turn"];
    expect(toolCalls(port).every(([name]) => allowed.includes(name as string))).toBe(true);
    const projectArgs = toolCalls(port).filter(([name]) => name === "get_project_cost");
    expect(projectArgs.every(([, args]) => ["projectId", "since", "until", "basis", "pricing", "currency"].join() === Object.keys(args as object).join())).toBe(true);
    expect(calls(port, "openLink")).toHaveLength(0);
    for (const call of calls(port, "sendMessage")) expect(call.args[0]).toBe("Analyse session 7f3a9c2e");
    expect(JSON.stringify(port.calls)).not.toContain("Refactor provider registry");
    expect(JSON.stringify(port.calls)).not.toContain("Provider platform");
  });

  it("sends nothing from the table until a row is opened", async () => {
    const { port } = setup();
    expect(port.calls.filter((call) => call.method !== "connect")).toEqual([]);
  });
});
