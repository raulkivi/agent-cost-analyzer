// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { EXTENSION_NO_PROJECTS_REASON } from "@agent-cost-analyzer/domain";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { ViewBrand } from "../brand/view-brand.js";
import type { ToolResult } from "../host/app-host-port.js";
import { FakeAppHostPort } from "../host/fake-app-host-port.js";
import { comparisonRow, costComparison, costSeries, costTotal, costVariance, point, projectCost } from "../view-models/cost-analysis-fixtures.js";
import { priceChangeList } from "../view-models/increment3-fixtures.js";
import { costRollup, sessionCost, turnSeries } from "../view-models/fixtures.js";
import { turnView } from "../view-models/turn-view-fixture.js";
import { CostChangeView } from "./CostChangeView.js";
import { CostCompareView } from "./CostCompareView.js";
import { CostOverTimeView } from "./CostOverTimeView.js";
import { CostRollupView } from "./CostRollupView.js";
import { PriceChangesView } from "./PriceChangesView.js";
import { FindingsView } from "./FindingsView.js";
import { ReplayView } from "./ReplayView.js";
import { SessionCostView } from "./SessionCostView.js";
import { findingsResult, SAMPLE_FINDINGS } from "./findings/fixtures.js";
import { boardComparison, boardReplay } from "./replay/fixtures.js";

// A14 (docs/plans/mcp-apps.md §7): every drill-down and filter works from
// the keyboard alone (Tab, Enter, Space, arrows), and focus lands somewhere
// sensible when the content under it is replaced.

const brand: ViewBrand = { productId: "vscode-extension", displayName: "AI Credits Analyzer", version: "0.4.0" };
const ok = (structuredContent: unknown): ToolResult => ({ structuredContent });

function port(): FakeAppHostPort {
  const fake = new FakeAppHostPort();
  fake.toolResults.set("get_turn_series", { structuredContent: turnSeries() });
  fake.toolResults.set("get_turn", { structuredContent: turnView() });
  fake.toolResults.set("get_session_cost", { structuredContent: sessionCost() });
  return fake;
}

// Tabs forward until `target` has focus; fails rather than looping forever.
async function tabTo(user: ReturnType<typeof userEvent.setup>, target: HTMLElement, limit = 40): Promise<void> {
  for (let presses = 0; presses < limit && document.activeElement !== target; presses += 1) await user.tab();
  expect(document.activeElement).toBe(target);
}

describe("U1 top turns by keyboard", () => {
  it("Tab reaches a top turn, Enter expands it, Space expands another, and Hide turn hands focus back", async () => {
    const user = userEvent.setup();
    render(<SessionCostView port={port()} brand={brand} result={ok(sessionCost())} />);
    await screen.findByRole("img", { name: /AI Credits per turn/ });

    const turn17 = screen.getByRole("button", { name: "Turn 17" });
    await tabTo(user, turn17);
    await user.keyboard("{Enter}");
    expect(await screen.findByText("Turn 17 · claude-sonnet-5.5")).toBeInTheDocument();
    expect(turn17).toHaveAttribute("aria-expanded", "true");

    const turn5 = screen.getByRole("button", { name: "Turn 5" });
    await tabTo(user, turn5);
    await user.keyboard(" ");
    expect(turn5).toHaveAttribute("aria-expanded", "true");

    const hide = screen.getAllByRole("button", { name: "Hide turn" })[0]!;
    hide.focus();
    await user.keyboard("{Enter}");
    expect(turn17).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(turn17);
  });
});

describe("U2 drill-down by keyboard", () => {
  it("Enter on a top session drills in with focus on Back, and Back returns focus to that session", async () => {
    const user = userEvent.setup();
    render(<CostRollupView port={port()} brand={brand} result={ok(costRollup())} />);

    const session = screen.getByRole("button", { name: "Refactor provider registry" });
    await tabTo(user, session);
    await user.keyboard("{Enter}");
    const back = await screen.findByRole("button", { name: "Back to cost rollup" });
    await waitFor(() => expect(document.activeElement).toBe(back));
    await screen.findByRole("button", { name: "Ask about this session" });
    // Loading the session must not steal focus from Back.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Back to cost rollup" }));

    await user.keyboard("{Enter}");
    const again = await screen.findByRole("button", { name: "Refactor provider registry" });
    expect(document.activeElement).toBe(again);
  });

  it("Space works too, and Back from a failed load still returns focus", async () => {
    const user = userEvent.setup();
    const fake = port();
    fake.toolResults.delete("get_session_cost");
    render(<CostRollupView port={fake} brand={brand} result={ok(costRollup())} />);
    await tabTo(user, screen.getByRole("button", { name: "Refactor provider registry" }));
    await user.keyboard(" ");
    await screen.findByRole("alert");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Back to cost rollup" }));
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Refactor provider registry" }));
  });
});

describe("U3 filters and evidence by keyboard", () => {
  it("Tab reaches the kind radios, arrows pick a kind, and the severity select takes the keyboard", async () => {
    const user = userEvent.setup();
    const fake = new FakeAppHostPort();
    fake.toolResults.set("list_findings", ok(findingsResult([SAMPLE_FINDINGS[0]!], { total: 1 })));
    render(<FindingsView brand={brand} port={fake} result={ok(findingsResult(SAMPLE_FINDINGS, { total: 3 }))} />);

    await tabTo(user, screen.getByRole("radio", { name: "All" }));
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Security" })).toBeChecked();
    await waitFor(() => expect(fake.calls.filter((c) => c.method === "callTool").map((c) => c.args)).toEqual([["list_findings", { kind: ["security"] }]]));

    const severity = screen.getByRole("combobox", { name: "Severity" });
    await user.tab();
    expect(document.activeElement).toBe(severity);
    // jsdom has no native select popup; a keyboard user changes it with the
    // arrows, which fire change, the same event this view listens to.
    await user.selectOptions(severity, "high");
    await waitFor(() => expect(fake.calls.filter((c) => c.method === "callTool")).toHaveLength(2));
    expect(fake.calls.at(-1)!.args).toEqual(["list_findings", { kind: ["security"], minSeverity: "high" }]);
  });

  it("Enter opens a finding's evidence and Enter closes it", async () => {
    const user = userEvent.setup();
    render(<FindingsView brand={brand} port={new FakeAppHostPort()} result={ok(findingsResult(SAMPLE_FINDINGS, { total: 3 }))} />);
    const toggle = screen.getByRole("button", { name: /Redacted evidence/ });
    await tabTo(user, toggle);
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("the findings table's scroll container is in the tab order", async () => {
    const user = userEvent.setup();
    render(<FindingsView brand={brand} port={new FakeAppHostPort()} result={ok(findingsResult(SAMPLE_FINDINGS, { total: 3 }))} />);
    await tabTo(user, screen.getByRole("region", { name: /Findings, scrollable/ }));
  });
});

describe("U9 cost over time by keyboard", () => {
  it("Tab reaches a top session, Enter opens it, and Back from the keyboard returns focus to the session", async () => {
    const user = userEvent.setup();
    render(<CostOverTimeView port={port()} brand={brand} result={ok(projectCost())} />);
    const session = screen.getByRole("button", { name: "Refactor provider registry" });
    await tabTo(user, session);
    await user.keyboard("{Enter}");
    const back = await screen.findByRole("button", { name: "Back to cost over time" });
    await waitFor(() => expect(document.activeElement).toBe(back));
    await user.keyboard("{Enter}");
    const again = screen.getByRole("button", { name: "Refactor provider registry" });
    await waitFor(() => expect(document.activeElement).toBe(again));
  });

  it("the currency switch is two radios reachable and changeable with the keyboard", async () => {
    const user = userEvent.setup();
    const mixed = { ...costTotal(10, 5, 5), amounts: [{ currency: "AI_CREDITS" as const, amount: 10, knownTurns: 5 }, { currency: "USD" as const, amount: 4, knownTurns: 5 }] };
    render(<CostOverTimeView port={port()} brand={brand} result={ok(costSeries({ bucket: "week", points: [point("2026-W42", "2026-10-12", "2026-10-18", mixed, mixed)], total: mixed }))} />);
    await tabTo(user, screen.getByRole("radio", { name: "AI Credits" }));
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "USD" })).toBeChecked();
  });

  it("the tables' scroll containers are in the tab order", async () => {
    const user = userEvent.setup();
    render(<CostOverTimeView port={port()} brand={brand} result={ok(projectCost())} />);
    await tabTo(user, screen.getByRole("region", { name: /Tokens by type, scrollable/ }));
    await tabTo(user, screen.getByRole("region", { name: /Top sessions, scrollable/ }));
  });
});

describe("U10 cost comparison by keyboard", () => {
  const projects = () => costComparison({ groupBy: "project", rows: [comparisonRow({ key: "p1", label: "Provider platform" }), comparisonRow({ key: "p2", label: "Other" })] });
  const chainPort = () => {
    const fake = port();
    fake.toolResults.set("get_project_cost", { structuredContent: projectCost() });
    return fake;
  };

  it("walks U10, U9 and U1 and back with Tab and Enter, landing focus at every level", async () => {
    const user = userEvent.setup();
    render(<CostCompareView port={chainPort()} brand={brand} result={ok(projects())} />);

    await tabTo(user, screen.getByRole("button", { name: "Provider platform" }));
    await user.keyboard("{Enter}");
    const backToComparison = await screen.findByRole("button", { name: "Back to comparison" });
    await waitFor(() => expect(document.activeElement).toBe(backToComparison));
    await screen.findByRole("heading", { name: "Acme platform" });

    await tabTo(user, screen.getByRole("button", { name: "Refactor provider registry" }));
    await user.keyboard("{Enter}");
    const backToProject = await screen.findByRole("button", { name: "Back to Acme platform" });
    await waitFor(() => expect(document.activeElement).toBe(backToProject));
    await screen.findByRole("img", { name: /AI Credits per turn/ });

    await user.keyboard("{Enter}");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Refactor provider registry" })));

    await tabTo(user, screen.getByRole("button", { name: "Back to comparison" }));
    await user.keyboard(" ");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Provider platform" })));
  });

  it("the table's scroll container is in the tab order", async () => {
    const user = userEvent.setup();
    render(<CostCompareView port={port()} brand={brand} result={ok(costComparison())} />);
    await tabTo(user, screen.getByRole("region", { name: /Cost by repository, scrollable/ }));
  });

  // A23: a drill-down that fails, and the extension's no-projects answer,
  // still put focus on Back and return it to the row.
  it("Back from a failed row and from the no-projects state returns focus to the row", async () => {
    const user = userEvent.setup();
    const failing = port();
    failing.toolResults.set("get_repository_cost", { isError: true, errorText: "the repository key is no longer in the logs" });
    const first = render(<CostCompareView port={failing} brand={brand} result={ok(costComparison())} />);
    await tabTo(user, screen.getByRole("button", { name: "widgets" }));
    await user.keyboard("{Enter}");
    await screen.findByRole("alert");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Back to comparison" })));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "widgets" })));
    first.unmount();

    const none = port();
    none.toolResults.set("get_project_cost", { isError: true, errorText: `Unknown project id "p1". Call list_projects to find valid ids. ${EXTENSION_NO_PROJECTS_REASON}` });
    render(<CostCompareView port={none} brand={brand} result={ok(projects())} />);
    await tabTo(user, screen.getByRole("button", { name: "Provider platform" }));
    await user.keyboard(" ");
    await screen.findByRole("heading", { name: "No projects here" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Back to comparison" })));
    await user.keyboard(" ");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Provider platform" })));
  });

  it("Back from a session that failed to load, two levels down, returns focus to the session row", async () => {
    const user = userEvent.setup();
    const fake = chainPort();
    fake.toolResults.delete("get_session_cost");
    render(<CostCompareView port={fake} brand={brand} result={ok(projects())} />);
    await tabTo(user, screen.getByRole("button", { name: "Provider platform" }));
    await user.keyboard("{Enter}");
    await screen.findByRole("heading", { name: "Acme platform" });
    await tabTo(user, screen.getByRole("button", { name: "Refactor provider registry" }));
    await user.keyboard("{Enter}");
    await screen.findByRole("alert");
    const back = screen.getByRole("button", { name: "Back to Acme platform" });
    await waitFor(() => expect(document.activeElement).toBe(back));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Refactor provider registry" })));
  });
});

describe("U11 cost change by keyboard", () => {
  it("Enter opens a model's token types, Space closes them, and focus stays on the toggle", async () => {
    const user = userEvent.setup();
    render(<CostChangeView port={port()} brand={brand} result={ok(costVariance())} />);
    const toggle = screen.getByRole("button", { name: "claude-sonnet-5.5" });
    await tabTo(user, toggle);
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("table", { name: "claude-sonnet-5.5 by token type" })).toBeInTheDocument();
    await tabTo(user, screen.getByRole("region", { name: "claude-sonnet-5.5 token types, scrollable" }));
    toggle.focus();
    await user.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("table", { name: "claude-sonnet-5.5 by token type" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(toggle);
  });

  it("the waterfall's View as table works from the keyboard", async () => {
    const user = userEvent.setup();
    render(<CostChangeView port={port()} brand={brand} result={ok(costVariance())} />);
    const viewAsTable = screen.getByRole("button", { name: "View as table" });
    await tabTo(user, viewAsTable);
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("table", { name: /Waterfall from 2026-09 to 2026-10/ })).toBeInTheDocument();
  });

  // A28: Tab reaches the Price changes control, Enter opens U13 in place,
  // Back is the first control and Enter on it returns to U11 with focus on
  // the control it left, without a second call.
  it("Tab and Enter open U13 from U11, Back returns focus to the Price changes control with no new call", async () => {
    const user = userEvent.setup();
    const fake = port();
    fake.toolResults.set("get_price_changes", ok(priceChangeList()));
    render(<CostChangeView port={fake} brand={brand} result={ok(costVariance())} />);
    const open = screen.getByRole("button", { name: "Price changes" });
    await tabTo(user, open);
    await user.keyboard("{Enter}");
    await screen.findByText(/1 of 2 changes in the range/);
    const back = screen.getByRole("button", { name: "Back to cost change" });
    expect(document.activeElement).toBe(back);
    await user.keyboard("{Enter}");
    expect(screen.getByRole("heading", { level: 1, name: "widgets" })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Price changes" }));
    expect(fake.calls.filter((call) => call.method === "callTool")).toHaveLength(1);
  });
});

describe("U13 price changes by keyboard", () => {
  it("Tab reaches each weekly table's scroll region and nothing else is a tab stop", async () => {
    const user = userEvent.setup();
    render(<PriceChangesView brand={brand} result={ok(priceChangeList())} />);
    const region = screen.getByRole("region", { name: /claude-sonnet-5\.5 weekly billed against priced, scrollable/ });
    await tabTo(user, region);
    const stops: Element[] = [];
    for (let presses = 0; presses < 6; presses += 1) {
      await user.tab();
      stops.push(document.activeElement!);
    }
    expect(stops.filter((stop) => stop !== document.body && stop !== region)).toEqual([]);
  });
});

describe("U12 replay by keyboard", () => {
  const replayPort = (): FakeAppHostPort => {
    const fake = new FakeAppHostPort();
    fake.toolResults.set("replay_session", { structuredContent: boardReplay() });
    return fake;
  };

  it("Tab reaches a model, Enter opens its replay with focus on Back, and Back returns focus to the model", async () => {
    const user = userEvent.setup();
    render(<ReplayView port={replayPort()} brand={brand} result={ok(boardComparison())} />);

    await tabTo(user, screen.getByRole("button", { name: "gpt-6.1-sol" }));
    await user.keyboard("{Enter}");
    await screen.findByText("Self-check failed.");
    const back = screen.getByRole("button", { name: "Back to model comparison" });
    await waitFor(() => expect(document.activeElement).toBe(back));

    await user.keyboard(" ");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "gpt-6.1-sol" })));
  });

  it("the measured row is not in the tab order: only the models are", async () => {
    const user = userEvent.setup();
    render(<ReplayView port={replayPort()} brand={brand} result={ok(boardComparison())} />);
    const reached: string[] = [];
    for (let presses = 0; presses < 5; presses += 1) {
      await user.tab();
      reached.push(document.activeElement?.textContent ?? "");
    }
    expect(reached).toEqual(["claude-sonnet-5.5", "claude-haiku-5.5", "gpt-6.1-sol", "local-llama-4", "claude-opus-5.5"]);
  });

  it("View as table works from the keyboard, and its container is in the tab order", async () => {
    const user = userEvent.setup();
    render(<ReplayView port={replayPort()} brand={brand} result={ok(boardReplay())} />);
    const toggle = screen.getByRole("button", { name: "View as table" });
    await tabTo(user, toggle);
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("table", { name: /Per-turn credits/ })).toBeInTheDocument();
    await tabTo(user, screen.getByRole("region", { name: "Per-turn credits, scrollable" }));
    toggle.focus();
    await user.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("Back from a replay that failed to load returns focus to the model", async () => {
    const user = userEvent.setup();
    const failing = new FakeAppHostPort();
    render(<ReplayView port={failing} brand={brand} result={ok(boardComparison())} />);
    await tabTo(user, screen.getByRole("button", { name: "claude-haiku-5.5" }));
    await user.keyboard("{Enter}");
    await screen.findByRole("alert");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Back to model comparison" })));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "claude-haiku-5.5" })));
  });
});
