// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { SessionReplay } from "@agent-cost-analyzer/domain";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ViewBrand } from "../brand/view-brand.js";
import type { ToolResult } from "../host/app-host-port.js";
import { FakeAppHostPort } from "../host/fake-app-host-port.js";
import { ReplayView } from "./ReplayView.js";
import { NO_TRACE, boardComparison, boardReplay, entry, mea } from "./replay/fixtures.js";

// U12 (plan §4.5, board Replay.dc.html, §9.2 Q1-Q5): compare mode, replay
// mode, and the click from one to the other through the port.

const brand: ViewBrand = { productId: "vscode-extension", displayName: "AI Credits Analyzer", version: "0.4.0" };
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

function setup(structured: unknown = boardComparison(), port: FakeAppHostPort = new FakeAppHostPort()) {
  port.toolResults.set("replay_session", { structuredContent: boardReplay() });
  const view = render(<ReplayView port={port} brand={brand} result={{ structuredContent: structured }} />);
  return { port, ...view };
}

const calls = (port: FakeAppHostPort, method: string) => port.calls.filter((call) => call.method === method);
const rowOf = (model: string) => screen.getByRole("button", { name: model }).closest("li")!;

describe("ReplayView, compare mode", () => {
  it("renders the header with the kicker, the Simulated tag, the session and the footer", () => {
    setup();
    expect(screen.getByRole("heading", { level: 1, name: /Replay on other models/ })).toBeInTheDocument();
    expect(screen.getByText("AI Credits Analyzer · Replay on other models")).toBeInTheDocument();
    expect(within(screen.getByRole("heading", { level: 1 })).getByText("Simulated")).toBeInTheDocument();
    expect(screen.getByText("Session 7f3a9c2e · 42 turns · measured on claude-sonnet-5.5")).toBeInTheDocument();
    expect(screen.getByText("Read-only · local logs · v0.4.0")).toBeInTheDocument();
  });

  it("states the own-model check from the entry flagged isMeasuredModel (Q1)", () => {
    setup();
    expect(screen.getByText(/replayed on its own model, claude-sonnet-5.5, the session comes to 183.90 AI Credits against 186.40 AI Credits measured \(−1.3 %\)/)).toBeInTheDocument();
    expect(screen.getByText("Own-model check:")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says measured on A, then B for a session that switched models, and calls out that there is no own-model check", () => {
    setup(boardComparison({ measuredModels: ["claude-sonnet-5.5", "claude-opus-5.5"], entries: [{ ...entry("claude-sonnet-5.5", 183.9, 42), isMixedSessionModel: true }, entry("claude-haiku-5.5", 38.2, 42)] }));
    expect(screen.getByText("Session 7f3a9c2e · 42 turns · measured on claude-sonnet-5.5, then claude-opus-5.5")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("No own-model check");
  });

  it("calls out a missing own-model check", () => {
    setup(boardComparison({ entries: [entry("claude-haiku-5.5", 38.2, 42)] }));
    expect(screen.getByRole("alert")).toHaveTextContent("No own-model check");
  });

  it("lists the measured row first, then the models in the tool's order, not by cost (Q4)", () => {
    setup();
    const rows = within(screen.getByRole("list", { name: "Simulated total per model" })).getAllByRole("listitem");
    expect(rows.map((row) => row.getAttribute("data-row"))).toEqual(["measured", "claude-sonnet-5.5", "claude-haiku-5.5", "gpt-6.1-sol", "local-llama-4", "claude-opus-5.5"]);
    expect(rows[0]).toHaveTextContent("186.40 AI Credits");
    expect(rows[0]).toHaveTextContent("known for 42 of 42 turns");
    expect(rows[0]).toHaveTextContent("log");
  });

  it("shows a fully replayed model's figure and its percent against the measured total, written with a sign", () => {
    setup();
    expect(rowOf("claude-haiku-5.5")).toHaveTextContent("38.20 AI Credits");
    expect(rowOf("claude-haiku-5.5")).toHaveTextContent("−79.5 %");
    expect(rowOf("claude-opus-5.5")).toHaveTextContent("+67.8 %");
    expect(rowOf("claude-sonnet-5.5")).toHaveTextContent("session's own model");
  });

  it("shows a partly replayed model as a floor with 'partial' and no percent (Q3)", () => {
    setup();
    const row = rowOf("gpt-6.1-sol");
    expect(row).toHaveTextContent("≥ 132.75 AI Credits");
    expect(row).toHaveTextContent("known for 40 of 42 turns");
    expect(row).toHaveTextContent("partial");
    expect(row.textContent).not.toMatch(/%/);
  });

  it("shows an unpriced model as Unknown with no bar and no 0 (Q4)", () => {
    setup();
    const row = rowOf("local-llama-4");
    expect(row).toHaveTextContent("Unknown");
    expect(row).toHaveTextContent("replayed 42 of 42 turns, none priced");
    expect(row.querySelector("[data-bar]")).toBeNull();
    expect(row.textContent).not.toMatch(/\b0(\.00)?\b/);
  });

  it("draws the measured bar solid and a simulated bar hatched, a floor open-ended (Q5)", () => {
    setup();
    expect(rowOf("claude-haiku-5.5").querySelector("[data-bar='measured']")).toBeNull();
    expect(document.querySelector("li[data-row='measured'] [data-bar='measured']")).not.toBeNull();
    expect(rowOf("claude-haiku-5.5").querySelector("[data-bar='simulated']")).not.toBeNull();
    expect(rowOf("gpt-6.1-sol").querySelector("[data-bar='simulated'][data-floor]")).not.toBeNull();
    expect(rowOf("claude-haiku-5.5").querySelector("[data-bar='simulated'][data-floor]")).toBeNull();
  });

  it("scales every bar on one axis: a larger figure is a longer bar", () => {
    setup();
    const width = (model: string) => Number.parseFloat((rowOf(model).querySelector("[data-bar]") as HTMLElement).style.width);
    expect(width("claude-opus-5.5")).toBeGreaterThan(width("claude-sonnet-5.5"));
    expect(width("claude-sonnet-5.5")).toBeGreaterThan(width("claude-haiku-5.5"));
  });

  it("says Simulated for every model figure, to a screen reader too, but not for the measured one", () => {
    setup();
    for (const model of ["claude-sonnet-5.5", "claude-haiku-5.5", "gpt-6.1-sol", "local-llama-4", "claude-opus-5.5"]) expect(rowOf(model)).toHaveTextContent("Simulated");
    expect(document.querySelector("li[data-row='measured']")).not.toHaveTextContent("Simulated");
  });

  it("keeps the legend, the sign note and the 'not what was billed' line", () => {
    setup();
    expect(screen.getByRole("list", { name: "Chart key" })).toHaveTextContent("measured, from the log");
    expect(screen.getByText(/≥ means a floor/)).toBeInTheDocument();
    expect(screen.getByText(/Figures are simulated, not what was billed/)).toBeInTheDocument();
  });

  it("makes each model a button; the measured row is not one", () => {
    setup();
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["claude-sonnet-5.5", "claude-haiku-5.5", "gpt-6.1-sol", "local-llama-4", "claude-opus-5.5"]);
  });

  it("reads Unknown for an unknown measured total", () => {
    setup(boardComparison({ measured: { value: null, knownTurns: 0, turns: 42 } }));
    expect(document.querySelector("li[data-row='measured']")).toHaveTextContent("Unknown");
    expect(rowOf("claude-haiku-5.5")).not.toHaveTextContent("%");
  });
});

describe("ReplayView, the click from compare to replay mode", () => {
  it("calls replay_session through the port with the ids from the result, and sends no message", async () => {
    const { port } = setup();
    fireEvent.click(screen.getByRole("button", { name: "gpt-6.1-sol" }));
    await screen.findByText("Self-check failed.");
    expect(screen.getByRole("button", { name: "Back to model comparison" })).toBeInTheDocument();
    expect(calls(port, "callTool")).toEqual([{ method: "callTool", args: ["replay_session", { sessionId: "7f3a9c2e", model: "gpt-6.1-sol", provider: "copilot" }] }]);
    expect(calls(port, "sendMessage")).toEqual([]);
    expect(calls(port, "openLink")).toEqual([]);
    expect(calls(port, "updateModelContext")).toEqual([]);
  });

  it("shows replay mode in place: the trail, the kicker, the model, and focus on Back", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "gpt-6.1-sol" }));
    await screen.findByText("Self-check failed.");
    const back = screen.getByRole("button", { name: "Back to model comparison" });
    expect(screen.getByText("Replay comparison / gpt-6.1-sol")).toBeInTheDocument();
    expect(screen.getByText("AI Credits Analyzer · Replay on other models › Session replay")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Replay on gpt-6.1-sol");
    await waitFor(() => expect(back).toHaveFocus());
  });

  it("shows a loading state first, then the replay", async () => {
    const port = new DeferredPort();
    setup(boardComparison(), port);
    fireEvent.click(screen.getByRole("button", { name: "claude-haiku-5.5" }));
    expect(screen.getByRole("status")).toHaveTextContent("Loading replay");
    expect(screen.getByRole("button", { name: "Back to model comparison" })).toBeInTheDocument();
    port.answer({ structuredContent: boardReplay({ model: "claude-haiku-5.5" }) });
    expect(await screen.findByText("Self-check failed.")).toBeInTheDocument();
  });

  it("Back returns to the comparison with no new call, and focus on the model's button", async () => {
    const { port } = setup();
    fireEvent.click(screen.getByRole("button", { name: "gpt-6.1-sol" }));
    await screen.findByText("Self-check failed.");
    fireEvent.click(screen.getByRole("button", { name: "Back to model comparison" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Replay on other models");
    await waitFor(() => expect(screen.getByRole("button", { name: "gpt-6.1-sol" })).toHaveFocus());
    expect(calls(port, "callTool")).toHaveLength(1);
  });

  it("says so when the call fails, offers Retry, and Back still works", async () => {
    const port = new FakeAppHostPort();
    const { unmount } = setup(boardComparison(), port);
    port.toolResults.delete("replay_session");
    fireEvent.click(screen.getByRole("button", { name: "gpt-6.1-sol" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load this replay.");
    port.toolResults.set("replay_session", { structuredContent: boardReplay() });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Self-check failed.")).toBeInTheDocument();
    expect(calls(port, "callTool")).toHaveLength(2);
    unmount();
  });

  it("shows a model id that is not a plain id as text, disabled, and never sends it", () => {
    const { port } = setup(boardComparison({ entries: [entry("gpt <b>x</b>", 10, 42), entry("claude-haiku-5.5", 38.2, 42)] }));
    expect(screen.getByRole("button", { name: "gpt <b>x</b>" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "claude-haiku-5.5" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "gpt <b>x</b>" }));
    expect(calls(port, "callTool")).toEqual([]);
  });

  it("drops an answer for another session or another model", async () => {
    const port = new FakeAppHostPort();
    setup(boardComparison(), port);
    port.toolResults.set("replay_session", { structuredContent: boardReplay({ sessionId: "other" }) });
    fireEvent.click(screen.getByRole("button", { name: "gpt-6.1-sol" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

describe("ReplayView, replay mode", () => {
  const direct = (overrides: Partial<SessionReplay> = {}, port = new FakeAppHostPort()) => setup(boardReplay(overrides), port);

  it("opens from a replay_session result with no Back, the Session replay kicker and the Simulated tag", () => {
    direct();
    expect(screen.getByText("AI Credits Analyzer · Session replay")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Back/ })).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Replay on gpt-6.1-sol");
    expect(within(screen.getByRole("heading", { level: 1 })).getByText("Simulated")).toBeInTheDocument();
    expect(screen.getByText(/Session 7f3a9c2e · measured on claude-sonnet-5.5 · priced at Copilot's AI Credit prices as of 2026-10-14/)).toBeInTheDocument();
  });

  it("puts a failed self-check in a danger alert with the counts, and keeps the figures (Q2)", () => {
    direct();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Self-check failed.");
    expect(alert).toHaveTextContent("matched 37 of 44 requests within 5 % cache read");
    expect(alert).toHaveTextContent("Treat them as rough, not as a quote.");
    expect(alert.className).toMatch(/rp-callout--fail/);
    expect(within(screen.getByRole("group", { name: /Simulated on gpt-6.1-sol/ })).getByText("8.32 AI Credits")).toBeInTheDocument();
  });

  it("states a passed self-check without an alert", () => {
    direct({ selfCheck: { model: "claude-sonnet-5.5", models: ["claude-sonnet-5.5"], requests: 44, matching: 44, readTolerancePercent: 5, passed: true } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Self-check passed")).toBeInTheDocument();
    expect(screen.getByText(/44 of 44 requests matched within 5 % cache read/)).toBeInTheDocument();
  });

  it("calls out a missing self-check", () => {
    direct({ selfCheck: null });
    expect(screen.getByRole("alert")).toHaveTextContent("No self-check.");
  });

  it("shows the Measured, Simulated and Difference tiles, the simulated one tagged", () => {
    direct();
    const measured = screen.getByRole("group", { name: "Measured · billed" });
    expect(measured).toHaveTextContent("12.10 AI Credits");
    expect(measured).toHaveTextContent("known for 4 of 6 turns");
    const simulated = screen.getByRole("group", { name: /Simulated on gpt-6.1-sol/ });
    expect(within(simulated).getByText("Simulated")).toBeInTheDocument();
    expect(simulated).toHaveTextContent("would have cost about");
    const difference = screen.getByRole("group", { name: "Difference" });
    expect(difference).toHaveTextContent("−3.78 AI Credits");
    expect(difference).toHaveTextContent("−31.2 %");
    expect(difference).toHaveTextContent("2 turns not replayed (7.61 AI Credits measured) are in neither total");
  });

  it("charts per-turn credits: measured solid with filled dots, simulated dashed with open diamonds, both labelled in the chart (Q5)", () => {
    direct();
    const chart = screen.getByRole("img", { name: /AI Credits per turn, measured and simulated on gpt-6.1-sol/ });
    expect(chart.querySelector("[data-series='measured'] polyline")).not.toBeNull();
    expect(chart.querySelector("[data-series='measured'] polyline")).not.toHaveAttribute("stroke-dasharray");
    expect(chart.querySelectorAll("[data-series='measured'] circle").length).toBe(5);
    expect(chart.querySelector("[data-series='simulated'] polyline")).toHaveAttribute("stroke-dasharray");
    expect(chart.querySelectorAll("[data-series='simulated'] path").length).toBe(4);
    const labels = [...chart.querySelectorAll("text")].map((node) => node.textContent);
    expect(labels).toContain("Measured");
    expect(labels).toContain("Simulated");
  });

  it("leaves a hatched gap for the turns not replayed, never a zero (Q3, Q5)", () => {
    direct();
    const chart = screen.getByRole("img", { name: /AI Credits per turn/ });
    const gap = chart.querySelector("[data-gap]");
    expect(gap).not.toBeNull();
    expect(gap!.querySelector("title")).toHaveTextContent(`Turns 2 and 3: not replayed, ${NO_TRACE}`);
    expect(screen.getByRole("img", { name: /2 turns not replayed/ })).toBeInTheDocument();
  });

  // A32, chart-marks rule (D11): hatching that carries meaning holds 3:1. The
  // hatch is drawn in the muted text colour (4.5:1 or more on every host);
  // painted at 45% it fell to 1.9-3.0:1, so it is drawn at full strength, as
  // U2's and U4's gaps are.
  it("paints the gap's hatching at full strength, so it holds 3:1", () => {
    direct();
    const chart = screen.getByRole("img", { name: /AI Credits per turn/ });
    const band = chart.querySelector("[data-gap] rect")!;
    expect(band.getAttribute("opacity") ?? "1").toBe("1");
    expect(band.getAttribute("fill-opacity") ?? "1").toBe("1");
    const hatch = chart.querySelector("pattern line")!;
    expect(hatch).toHaveAttribute("stroke", "var(--color-text-muted)");
    expect(hatch.getAttribute("stroke-opacity") ?? "1").toBe("1");
  });

  it("offers the per-turn figures as a table, with the reason and Unknown for what was not replayed", () => {
    direct();
    expect(screen.queryByRole("table", { name: /Per-turn/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View as table" }));
    const table = screen.getByRole("table", { name: "Per-turn credits, measured and simulated" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(7);
    expect(rows[3]).toHaveTextContent("2");
    expect(rows[3]).toHaveTextContent("4.26 AI Credits");
    expect(rows[3]).toHaveTextContent("Unknown");
    expect(rows[3]).toHaveTextContent(`not replayed: ${NO_TRACE}`);
    expect(rows[6]).toHaveTextContent("Unknown");
    expect(rows[1]).toHaveTextContent("1.49 AI Credits");
    expect(rows[1]).toHaveTextContent("cache hit");
    fireEvent.click(screen.getByRole("button", { name: "Hide table" }));
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("lists the reasons turns were not replayed, with Unknown not 0", () => {
    direct();
    const section = screen.getByRole("region", { name: "Not replayed" });
    expect(section).toHaveTextContent("2 of 6 turns");
    expect(section).toHaveTextContent(`2 turns: ${NO_TRACE}`);
    expect(section).toHaveTextContent("Their simulated cost is Unknown, not 0.");
  });

  it("has no Not replayed section when every turn was replayed", () => {
    const turn = boardReplay().turns[0]!;
    direct({ turns: [turn], coverage: { turns: 1, replayedTurns: 1, requests: 1, replayedRequests: 1, notReplayed: [] }, totals: { measured: { value: 2.09, knownTurns: 1, turns: 1 }, simulated: { value: 1.49, knownTurns: 1, turns: 1 }, difference: -0.6 } });
    expect(screen.queryByRole("region", { name: "Not replayed" })).toBeNull();
    expect(screen.queryByText(/in neither total/)).toBeNull();
  });

  it("collapses the assumptions, and opens them on request", () => {
    direct();
    const details = screen.getByText("Show 2 assumptions").closest("details")!;
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent("Same conversation: the other model gets the same prompts.");
    expect(details).toHaveTextContent("confidence: documented");
  });

  it("ends with the line that the figures are simulated, not what was billed", () => {
    direct();
    expect(screen.getByText(/Simulated: assumes the same conversation and token counts/)).toBeInTheDocument();
    expect(screen.getByText(/It is not what was billed\./)).toBeInTheDocument();
  });

  it("shows Unknown, not 0, with no chart, when the model has no price", () => {
    direct({
      model: "local-llama-4",
      pricing: { channel: null, reason: "no price for local-llama-4 on the Copilot channel", asOf: "2026-10-14", requested: "session-channel" },
      turns: [
        { turnIndex: 0, measured: mea(2), simulated: { cacheRead: 1, cacheWrite: 1, outcome: "hit", cost: { known: false, reason: "no price" } } },
        { turnIndex: 1, measured: mea(3), simulated: { cacheRead: 1, cacheWrite: 1, outcome: "hit", cost: { known: false, reason: "no price" } } },
      ],
      totals: { measured: { value: 5, knownTurns: 2, turns: 2 }, simulated: { value: null, knownTurns: 0, turns: 2 }, difference: null },
      coverage: { turns: 2, replayedTurns: 2, requests: 2, replayedRequests: 2, notReplayed: [] },
      selfCheck: { model: "claude-sonnet-5.5", models: ["claude-sonnet-5.5"], requests: 44, matching: 44, readTolerancePercent: 5, passed: true },
    });
    const simulated = screen.getByRole("group", { name: /Simulated on local-llama-4/ });
    expect(simulated).toHaveTextContent("Unknown");
    expect(screen.getByRole("group", { name: "Difference" })).toHaveTextContent("Unknown");
    expect(screen.getByText("No simulated cost.")).toBeInTheDocument();
    expect(screen.getAllByText(/no price for local-llama-4 on the Copilot channel/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("group", { name: "Difference" }).textContent).not.toMatch(/\b0\b/);
  });
});

describe("ReplayView, states", () => {
  it("waits for the result", () => {
    render(<ReplayView port={new FakeAppHostPort()} brand={brand} result={undefined} />);
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for the replay");
  });

  it("shows the tool's error text in an alert, in place of the views", () => {
    render(<ReplayView port={new FakeAppHostPort()} brand={brand} result={{ isError: true, errorText: "Unknown session id 7f3a" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load the replay.");
    expect(screen.getByRole("alert")).toHaveTextContent("Unknown session id 7f3a");
  });

  it("says a result it can't read is one it can't read", () => {
    render(<ReplayView port={new FakeAppHostPort()} brand={brand} result={{ structuredContent: { nope: 1 } }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("can't read");
  });

  it("an error with no text still says so", () => {
    render(<ReplayView port={new FakeAppHostPort()} brand={brand} result={{ isError: true }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The tool returned an error");
  });
});
