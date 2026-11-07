// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ViewBrand } from "../brand/view-brand.js";
import type { ToolResult } from "../host/app-host-port.js";
import { FakeAppHostPort } from "../host/fake-app-host-port.js";
import { costRollup, measures, sessionCost, total, turnSeries } from "../view-models/fixtures.js";
import { CostRollupView } from "./CostRollupView.js";

const brand: ViewBrand = { productId: "vscode-extension", displayName: "AI Credits Analyzer", version: "0.4.0" };

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

function setup(options: { rollup?: ReturnType<typeof costRollup>; port?: FakeAppHostPort } = {}) {
  const port = options.port ?? new FakeAppHostPort();
  port.toolResults.set("get_session_cost", { structuredContent: sessionCost() });
  port.toolResults.set("get_turn_series", { structuredContent: turnSeries() });
  const view = render(<CostRollupView port={port} brand={brand} result={{ structuredContent: options.rollup ?? costRollup() }} />);
  return { port, ...view };
}

const calls = (port: FakeAppHostPort, method: string) => port.calls.filter((call) => call.method === method);
const openSession = (title: string) => fireEvent.click(screen.getByRole("button", { name: title }));

describe("CostRollupView content", () => {
  it("renders the header, period, KPI tiles with coverage, and the footer", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Cost rollup" })).toBeInTheDocument();
    expect(screen.getByText("AI Credits Analyzer · Cost rollup")).toBeInTheDocument();
    expect(screen.getByText("Oct 27 – Nov 2")).toBeInTheDocument();
    const credits = screen.getByRole("group", { name: "AI Credits" });
    expect(within(credits).getByText("142.60")).toBeInTheDocument();
    expect(within(credits).getByText("known for 318 of 334 turns")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Sessions" })).getByText("23")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Turns" })).getByText("334")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Cache hit" })).getByText("81 %")).toBeInTheDocument();
    expect(screen.getByText("Read-only · local logs · v0.4.0")).toBeInTheDocument();
  });

  it("draws daily spend with a hatched gap for an unknown day", () => {
    setup();
    const chart = screen.getByRole("img", { name: "Daily AI Credits, 3 days" });
    expect(within(chart).getByText("Oct 27: 30.00 AI Credits")).toBeInTheDocument();
    expect(within(chart).getByText("Oct 28: Unknown")).toBeInTheDocument();
    expect(within(chart).getByText("Oct 29: 112.60 AI Credits")).toBeInTheDocument();
    expect(chart.querySelectorAll("[data-unknown]")).toHaveLength(1);
  });

  it("lists spend by model and by provider with shares, and Unknown without a bar", () => {
    setup();
    const models = screen.getByRole("list", { name: "Spend by model" });
    const sonnet = within(models).getByText("claude-sonnet-5.5").closest("li")!;
    expect(within(sonnet).getByText("88.10")).toBeInTheDocument();
    expect(within(sonnet).getByText("62 %")).toBeInTheDocument();
    const mystery = within(models).getByText("mystery-model").closest("li")!;
    expect(within(mystery).getAllByText("Unknown")).toHaveLength(2);
    expect(mystery.querySelector("[data-bar]")).toBeNull();
    expect(sonnet.querySelector("[data-bar]")).not.toBeNull();
    const providers = screen.getByRole("list", { name: "Spend by provider" });
    expect(within(providers).getByText("Copilot Chat")).toBeInTheDocument();
    expect(within(providers).getByText("96.20")).toBeInTheDocument();
  });

  it("lists top sessions with provider label, model, turns, credits and a coverage note", () => {
    setup();
    const table = screen.getByRole("table", { name: "Top sessions by AI Credits" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(within(rows[1]!).getByText("Copilot Chat")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("claude-sonnet-5.5")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("42 turns")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("18.42")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("known for 40 of 42 turns")).toBeInTheDocument();
  });

  it("shows Unknown, never 0, for unknown figures", () => {
    setup({ rollup: costRollup({ totals: measures(334, { aiCredits: total(null, 0, 334) }), cacheHitRatio: null }) });
    expect(within(screen.getByRole("group", { name: "AI Credits" })).getByText("Unknown")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Cache hit" })).getByText("Unknown")).toBeInTheDocument();
    const rows = within(screen.getByRole("table", { name: "Top sessions by AI Credits" })).getAllByRole("row");
    expect(within(rows[2]!).getByText("Unknown")).toBeInTheDocument();
    expect(within(rows[2]!).queryByText("0")).not.toBeInTheDocument();
    expect(within(rows[2]!).queryByText("0.00")).not.toBeInTheDocument();
  });

  it("says so when there are no sessions", () => {
    setup({ rollup: costRollup({ topSessions: [], daily: [], byModel: [], byProvider: [] }) });
    expect(screen.getByText("No sessions in this period.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("waits for the result, and shows an error for a failed or unreadable one", () => {
    const port = new FakeAppHostPort();
    const { rerender } = render(<CostRollupView port={port} brand={brand} result={undefined} />);
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for the cost rollup");
    rerender(<CostRollupView port={port} brand={brand} result={{ isError: true }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load the cost rollup.");
    rerender(<CostRollupView port={port} brand={brand} result={{ structuredContent: { nope: 1 } }} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});

describe("CostRollupView drill-down into U1", () => {
  it("calls get_session_cost with the session id and provider, and swaps to the session view in place", async () => {
    const { port } = setup();
    openSession("Refactor provider registry");
    expect(calls(port, "callTool")[0]!.args).toEqual(["get_session_cost", { sessionId: "7f3a9c2e", provider: "copilot" }]);
    expect(await screen.findByRole("heading", { name: "Refactor provider registry" })).toBeInTheDocument();
    expect(screen.getByText("AI Credits Analyzer · Cost rollup › Session cost")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Input tokens" })).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Top sessions by AI Credits" })).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Daily AI Credits/ })).not.toBeInTheDocument();
  });

  it("shows loading while the call is in flight", async () => {
    const port = new DeferredPort();
    setup({ port });
    openSession("Refactor provider registry");
    expect(screen.getByRole("status")).toHaveTextContent("Loading session");
    expect(screen.getByRole("button", { name: "Back to cost rollup" })).toBeInTheDocument();
    await act(async () => port.answer({ structuredContent: sessionCost() }));
    expect(await screen.findByRole("group", { name: "Input tokens" })).toBeInTheDocument();
  });

  it("goes back to the rollup without fetching it again", async () => {
    const { port } = setup();
    openSession("Refactor provider registry");
    await screen.findByRole("group", { name: "Input tokens" });
    const before = calls(port, "callTool").length;
    fireEvent.click(screen.getByRole("button", { name: "Back to cost rollup" }));
    expect(screen.getByRole("table", { name: "Top sessions by AI Credits" })).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "AI Credits" })).getByText("142.60")).toBeInTheDocument();
    expect(calls(port, "callTool")).toHaveLength(before);
  });

  it("shows an error with Back and Retry when the call fails, and Retry recovers", async () => {
    const port = new FakeAppHostPort();
    setup({ port });
    port.toolResults.set("get_session_cost", { isError: true });
    openSession("Refactor provider registry");
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load this session.");
    expect(screen.getByRole("button", { name: "Back to cost rollup" })).toBeInTheDocument();
    port.toolResults.set("get_session_cost", { structuredContent: sessionCost() });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("group", { name: "Input tokens" })).toBeInTheDocument();
    expect(calls(port, "callTool").filter((c) => c.args[0] === "get_session_cost")).toHaveLength(2);
  });

  it("treats a rejected call as an error and can still go back", async () => {
    const port = new FakeAppHostPort();
    setup({ port });
    port.callTool = () => Promise.reject(new Error("host gone"));
    openSession("Draft release notes");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to cost rollup" }));
    expect(screen.getByRole("table", { name: "Top sessions by AI Credits" })).toBeInTheDocument();
  });

  it("ignores an answer for a session the user already left", async () => {
    const port = new DeferredPort();
    setup({ port });
    openSession("Refactor provider registry");
    fireEvent.click(screen.getByRole("button", { name: "Back to cost rollup" }));
    await act(async () => port.answer({ structuredContent: sessionCost() }));
    expect(screen.getByRole("table", { name: "Top sessions by AI Credits" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Input tokens" })).not.toBeInTheDocument();
  });

  it("does not show a result for another session", async () => {
    const port = new FakeAppHostPort();
    setup({ port });
    port.toolResults.set("get_session_cost", { structuredContent: sessionCost({ sessionId: "other" }) });
    openSession("Refactor provider registry");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

describe("CostRollupView Ask about this session", () => {
  const ask = () => screen.findByRole("button", { name: "Ask about this session" });

  it("is not offered on the rollup itself", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Ask about this session" })).not.toBeInTheDocument();
  });

  it("sends the fixed template with only the session id", async () => {
    const { port } = setup();
    openSession("Refactor provider registry");
    fireEvent.click(await ask());
    await waitFor(() => expect(calls(port, "sendMessage")).toHaveLength(1));
    expect(calls(port, "sendMessage")[0]!.args).toEqual(["Analyse session 7f3a9c2e"]);
    expect(await screen.findByText("Sent to the chat.")).toBeInTheDocument();
  });

  it("says so when the host does not take the message", async () => {
    const port = new FakeAppHostPort();
    port.sendMessageResult = false;
    setup({ port });
    openSession("Refactor provider registry");
    fireEvent.click(await ask());
    expect(await screen.findByText("The host didn't accept the message.")).toBeInTheDocument();
  });
});

describe("CostRollupView sends no logged text (plan section 6)", () => {
  it("keeps session titles out of sendMessage, tool arguments, links and context", async () => {
    const title = "Rotate the AWS_SECRET deploy key for acme-prod";
    const rollup = costRollup();
    rollup.topSessions[0] = { ...rollup.topSessions[0]!, title };
    const port = new FakeAppHostPort();
    setup({ port, rollup });
    port.toolResults.set("get_session_cost", { structuredContent: sessionCost({ title }) });
    openSession(title);
    fireEvent.click(await screen.findByRole("button", { name: "Ask about this session" }));
    await waitFor(() => expect(calls(port, "sendMessage")).toHaveLength(1));
    const everything = JSON.stringify(port.calls);
    expect(everything).not.toContain("AWS_SECRET");
    expect(everything).not.toContain("acme-prod");
    expect(everything).not.toContain(title);
    expect(calls(port, "openLink")).toHaveLength(0);
    expect(port.calls.map((c) => c.method).filter((m) => m !== "callTool" && m !== "sendMessage")).toEqual([]);
  });
});
