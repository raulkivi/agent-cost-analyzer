// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FakeAppHostPort } from "../../host/fake-app-host-port.js";
import type { ClipboardPort } from "../../host/clipboard-port.js";
import type { ViewBrand } from "../../brand/view-brand.js";
import { sessionCost, total, turnSeries, measures } from "../../view-models/fixtures.js";
import { subagentRun, turnView, turnViewWithRuns } from "../../view-models/turn-view-fixture.js";
import { SessionCostView } from "../SessionCostView.js";
import { exerciseEveryControl } from "../../test-support/exercise-controls.js";

const extension: ViewBrand = { productId: "vscode-extension", displayName: "AI Credits Analyzer", version: "0.4.0" };
const standalone: ViewBrand = { productId: "standalone", displayName: "Agent Cost Analyzer", version: "0.11.0" };

function setup(options: { cost?: ReturnType<typeof sessionCost>; brand?: ViewBrand; clipboard?: ClipboardPort | null; series?: boolean } = {}) {
  const port = new FakeAppHostPort();
  if (options.series !== false) port.toolResults.set("get_turn_series", { structuredContent: turnSeries() });
  port.toolResults.set("get_turn", { structuredContent: turnView() });
  const clipboard = options.clipboard === null ? undefined : (options.clipboard ?? { writeText: vi.fn().mockResolvedValue(undefined) });
  const view = render(<SessionCostView port={port} brand={options.brand ?? extension} clipboard={clipboard} result={{ structuredContent: options.cost ?? sessionCost() }} />);
  return { port, clipboard, ...view };
}

const calls = (port: FakeAppHostPort, method: string) => port.calls.filter((call) => call.method === method);

describe("SessionCostView content", () => {
  it("renders the header, KPI tiles with coverage and estimate tags, and the footer", async () => {
    setup();
    expect(screen.getByRole("heading", { name: "Refactor provider registry" })).toBeInTheDocument();
    expect(screen.getByText("AI Credits Analyzer · Session cost")).toBeInTheDocument();
    expect(screen.getByText("claude-sonnet-5.5 · 42 turns · Oct 27")).toBeInTheDocument();
    const credits = screen.getByRole("group", { name: "AI Credits" });
    expect(within(credits).getByText("18.42")).toBeInTheDocument();
    expect(within(credits).getByText("known for 40 of 42 turns")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Cache hit" })).getByText("87 %")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Output tokens" })).getByText("estimate")).toBeInTheDocument();
    expect(screen.getByText("Read-only · local logs · v0.4.0")).toBeInTheDocument();
    await screen.findByRole("img", { name: /AI Credits per turn/ });
  });

  it("fetches the per-turn series for this session and draws the chart with event markers and an unknown note", async () => {
    const { port } = setup();
    const chart = await screen.findByRole("img", { name: "AI Credits per turn, 4 turns; highest 4.10 at turn 2; 1 turn unknown" });
    expect(calls(port, "callTool")[0]!.args).toEqual(["get_turn_series", { sessionId: "7f3a9c2e" }]);
    expect(screen.getByText("1 turn unknown")).toBeInTheDocument();
    expect(within(chart).getByText("Turn 2: 4.10 AI Credits (estimate), compaction, model switch")).toBeInTheDocument();
    expect(within(chart).getByText("Turn 1: Unknown")).toBeInTheDocument();
    expect(chart.querySelectorAll("[data-event]").length).toBe(1);
  });

  it("names input tokens as the ranking when the server ranked by them", () => {
    setup({ cost: sessionCost({ rankedBy: "inputTokens" }) });
    expect(screen.getByRole("table", { name: "Top turns by input tokens" })).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Top turns by AI Credits" })).not.toBeInTheDocument();
    expect(screen.getByText("by input tokens · click a turn for its detail")).toBeInTheDocument();
  });

  it("names AI Credits as the ranking otherwise", () => {
    setup();
    expect(screen.getByText("by AI Credits · click a turn for its detail")).toBeInTheDocument();
  });

  it("lists top turns with event tags", () => {
    setup();
    const table = screen.getByRole("table", { name: "Top turns by AI Credits" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(4);
    expect(within(rows[1]!).getByText("compaction")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("4.10")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("310 k")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("model switch")).toBeInTheDocument();
  });

  it("shows the context overhead", () => {
    setup();
    expect(screen.getByRole("img", { name: /System prompt 21 k/ })).toBeInTheDocument();
    expect(screen.getByText("14 of 52 tools unused")).toBeInTheDocument();
  });

  it("states the reason when overhead is unavailable", () => {
    setup({ cost: sessionCost({ contextOverhead: { unavailableReason: "The log has no system prompt." } }) });
    expect(screen.getByText("The log has no system prompt.")).toBeInTheDocument();
  });
});

describe("SessionCostView unknown values", () => {
  it("never shows 0 for an unknown measure", async () => {
    const unknown = total(null, 0, 42);
    const cost = sessionCost({ cacheHitRatio: null as unknown as number, totals: measures(42, { aiCredits: unknown, inputTokens: unknown, output: unknown }) });
    setup({ cost });
    for (const label of ["AI Credits", "Input tokens", "Cache hit", "Output tokens"]) {
      const tile = screen.getByRole("group", { name: label });
      expect(within(tile).getByText("Unknown")).toBeInTheDocument();
      expect(tile.textContent).not.toMatch(/(^|\D)0(\D|$)/);
    }
    await screen.findByRole("img", { name: /AI Credits per turn/ });
  });

  it("explains an Unknown input total with the known parts, and an unlogged prompt (A16)", () => {
    const base = sessionCost();
    const cost = sessionCost({
      totals: measures(1, {
        uncachedInput: total(14_788, 1, 1),
        cacheWrite: total(null, 0, 1),
        cacheRead: total(119_322, 1, 1),
        inputTokens: total(null, 0, 1),
      }),
      cacheHitRatio: null,
      topTurns: [{ ...base.topTurns[0]!, userMessage: "" }],
    });
    setup({ cost });
    const input = screen.getByRole("group", { name: "Input tokens" });
    expect(within(input).getByText("Unknown")).toBeInTheDocument();
    expect(within(input).getByText("14.8 k uncached + 119 k cache read; cache writes not logged")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Cache hit" })).getByText("cache writes not logged")).toBeInTheDocument();
    const rows = within(screen.getByRole("table", { name: "Top turns by AI Credits" })).getAllByRole("row");
    expect(within(rows[1]!).getByText("Prompt not recorded")).toHaveClass("view-unknown");
  });

  it("shows Unknown for an unknown top turn, and draws an unknown chart turn as a gap (not a zero bar)", async () => {
    setup();
    const row = within(screen.getByRole("table", { name: "Top turns by AI Credits" })).getAllByRole("row")[3]!;
    expect(within(row).getAllByText("Unknown")).toHaveLength(2);
    const chart = await screen.findByRole("img", { name: /AI Credits per turn/ });
    expect(chart.querySelectorAll("[data-unknown]")).toHaveLength(1);
    expect(chart.querySelector("[data-unknown]")!.getAttribute("fill")).toContain("url(#");
  });
});

describe("SessionCostView chart measure", () => {
  it("plots input tokens under its own heading when the session is ranked by input tokens", async () => {
    setup({ cost: sessionCost({ rankedBy: "inputTokens" }) });
    const chart = await screen.findByRole("img", { name: "Input tokens per turn, 4 turns; highest 310 k at turn 2; 1 turn unknown" });
    expect(screen.getByRole("heading", { name: "Input tokens per turn" })).toBeInTheDocument();
    expect(within(chart).getByText("Turn 2: 310 k input tokens (estimate), compaction, model switch")).toBeInTheDocument();
    expect(within(chart).getByText("Turn 1: Unknown")).toBeInTheDocument();
  });
});

describe("SessionCostView chart failure", () => {
  it("keeps the figures, explains the failure and retries", async () => {
    const { port } = setup({ series: false });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load the per-turn chart");
    expect(screen.getByText("18.42")).toBeInTheDocument();
    port.toolResults.set("get_turn_series", { structuredContent: turnSeries() });
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("img", { name: "AI Credits per turn, 4 turns; highest 4.10 at turn 2; 1 turn unknown" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("treats a rejected callTool as a failure too", async () => {
    const port = new FakeAppHostPort();
    port.callTool = () => Promise.reject(new Error("host went away"));
    render(<SessionCostView port={port} brand={extension} result={{ structuredContent: sessionCost() }} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the per-turn chart");
  });

  it("ignores a series for another session", async () => {
    const port = new FakeAppHostPort();
    port.toolResults.set("get_turn_series", { structuredContent: turnSeries({ sessionId: "other" }) });
    render(<SessionCostView port={port} brand={extension} result={{ structuredContent: sessionCost() }} />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

describe("SessionCostView turn drill-down", () => {
  it("calls get_turn with the session and turn index and expands the turn inline", async () => {
    const { port } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Turn 17/ }));
    expect(await screen.findByText("Turn 17 · claude-sonnet-5.5")).toBeInTheDocument();
    expect(calls(port, "callTool").map((call) => call.args)).toContainEqual(["get_turn", { sessionId: "7f3a9c2e", turnIndex: 17 }]);
    expect(screen.getByText("Context was compacted before this turn.")).toBeInTheDocument();
    expect(screen.getByText("268,090")).toBeInTheDocument();
    expect(screen.getByText(/read_file ×2/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Turn 17/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("shows a loading state until the call resolves", async () => {
    const { port } = setup();
    let release: (() => void) | undefined;
    port.callTool = (name) =>
      name === "get_turn" ? new Promise<{ structuredContent: unknown }>((resolve) => { release = () => resolve({ structuredContent: turnView() }); }) : Promise.resolve({ structuredContent: turnSeries() });
    fireEvent.click(screen.getByRole("button", { name: /Turn 5/ }));
    expect(await screen.findByRole("status")).toHaveTextContent("Loading turn 5");
    act(() => release?.());
    await waitFor(() => expect(screen.queryByText("Loading turn 5")).toBeNull());
  });

  it("shows an error and retries when get_turn fails", async () => {
    const { port } = setup();
    port.toolResults.delete("get_turn");
    fireEvent.click(screen.getByRole("button", { name: /Turn 17/ }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load turn 17");
    port.toolResults.set("get_turn", { structuredContent: turnView() });
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Turn 17 · claude-sonnet-5.5")).toBeInTheDocument();
  });

  it("hides the turn again and fetches it once", async () => {
    const { port } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Turn 17/ }));
    await screen.findByText("Turn 17 · claude-sonnet-5.5");
    fireEvent.click(screen.getByRole("button", { name: "Hide turn" }));
    expect(screen.queryByText("Turn 17 · claude-sonnet-5.5")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Turn 17/ }));
    await screen.findByText("Turn 17 · claude-sonnet-5.5");
    expect(calls(port, "callTool").filter((call) => call.args[0] === "get_turn")).toHaveLength(1);
  });

  it("passes the provider when the session names one", async () => {
    const { port } = setup({ cost: sessionCost({ providerId: "claude-code" }) });
    fireEvent.click(screen.getByRole("button", { name: /Turn 17/ }));
    await screen.findByText("Turn 17 · claude-sonnet-5.5");
    expect(calls(port, "callTool").map((call) => call.args)).toContainEqual(["get_turn", { sessionId: "7f3a9c2e", turnIndex: 17, provider: "claude-code" }]);
  });
});

describe("SessionCostView turn drill-down with subagent runs", () => {
  async function openWith(view: ReturnType<typeof turnView>) {
    const handle = setup();
    handle.port.toolResults.set("get_turn", { structuredContent: view });
    fireEvent.click(screen.getByRole("button", { name: /Turn 17/ }));
    await screen.findByText("Subagent runs (" + (view.usage.subagents?.length ?? 0) + ")");
    return handle;
  }

  it("lists the runs under the turn with the marker note, agent names and the shares", async () => {
    await openWith(turnViewWithRuns([subagentRun(), subagentRun({ id: "call_b", label: "runSubagent-Plan", agentName: "Plan", roundsCount: 9, costAiCredits: { known: true, value: 11.95 } })]));
    const list = screen.getByRole("list");
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Exploreclaude-haiku-4.514 requests30.11 AI Credits",
      "Planclaude-haiku-4.59 requests11.95 AI Credits",
    ]);
    expect(screen.getByText("incl. 42.06 from 2 subagent runs")).toBeInTheDocument();
    expect(screen.getByText("Main agent").parentElement).toHaveTextContent("Main agent 4.25");
  });

  it("shows the marker at 0.00 and says matched by time on the run", async () => {
    await openWith(turnViewWithRuns([subagentRun({ attribution: "timestamp", roundsCount: 0, costAiCredits: { known: true, value: 0 } })]));
    expect(screen.getByText("incl. 0.00 from 1 subagent run, matched by time")).toBeInTheDocument();
    expect(within(screen.getByRole("list")).getByText("matched by time")).toBeInTheDocument();
    expect(screen.getByText("0 requests")).toBeInTheDocument();
  });

  it("shows an unknown run as Unknown with its reason, never 0", async () => {
    await openWith(turnViewWithRuns([subagentRun({ label: "runSubagent-Plan", agentName: undefined, model: "", costAiCredits: { known: false, reason: "The subagent log runSubagent-Plan is missing." } })]));
    const item = within(screen.getByRole("list")).getByRole("listitem");
    expect(item).toHaveTextContent("runSubagent-Plan");
    expect(item).toHaveTextContent("model unknown");
    expect(item).toHaveTextContent("Unknown");
    expect(item).toHaveTextContent("The subagent log runSubagent-Plan is missing.");
    expect(item.textContent).not.toMatch(/\b0\.00\b/);
    expect(screen.getByText("unknown: The subagent log runSubagent-Plan is missing.")).toBeInTheDocument();
  });

  it("shows no subagent section for a turn without runs", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Turn 17/ }));
    await screen.findByText("Turn 17 · claude-sonnet-5.5");
    expect(screen.queryByText(/Subagent runs/)).toBeNull();
  });
});

describe("SessionCostView copy-command button", () => {
  it("copies the session title for the Open Session picker and says how to use it (plan §4.4, decision A)", async () => {
    const { clipboard, port } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Copy title to open in panel" }));
    await waitFor(() => expect(clipboard!.writeText).toHaveBeenCalledWith("Refactor provider registry"));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent('Copied "Refactor provider registry". Run "AI Credits Analyzer: Open Session…" from the Command Palette (Ctrl+Shift+P) and paste it.');
    expect(screen.getByRole("status").querySelector("code")).toBeNull(); // <code> padding read as stray spaces in High Contrast
    expect(calls(port, "openLink")).toHaveLength(0);
  });

  it("returns to the idle label after a moment", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      setup();
      fireEvent.click(screen.getByRole("button", { name: "Copy title to open in panel" }));
      await screen.findByRole("button", { name: "Copied" });
      await act(async () => {});
      act(() => vi.advanceTimersByTime(3000));
      expect(screen.getByRole("button", { name: "Copy title to open in panel" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("says so, and shows the text to copy by hand, when the clipboard write fails", async () => {
    setup({ clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    fireEvent.click(screen.getByRole("button", { name: "Copy title to open in panel" }));
    expect((await screen.findByText(/Couldn't copy/)).closest('[role="status"]')).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent('Run "AI Credits Analyzer: Open Session…" from the Command Palette and search for: Refactor provider registry');
  });

  it("is hidden when the clipboard is unavailable", () => {
    setup({ clipboard: null });
    expect(screen.queryByRole("button", { name: /Copy/ })).toBeNull();
  });

  it("is hidden for the standalone product, which has no panel to open", () => {
    setup({ brand: standalone });
    expect(screen.queryByRole("button", { name: /Copy/ })).toBeNull();
    expect(screen.getByText("Read-only · local logs · v0.11.0")).toBeInTheDocument();
  });
});

describe("SessionCostView bad results", () => {
  it("shows an error state for an error result", () => {
    const port = new FakeAppHostPort();
    render(<SessionCostView port={port} brand={extension} result={{ isError: true, structuredContent: undefined }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load this session");
    expect(screen.getByRole("heading", { name: "Session cost" })).toBeInTheDocument();
  });

  it("shows an error state for a result that is not a session cost", () => {
    const port = new FakeAppHostPort();
    render(<SessionCostView port={port} brand={extension} result={{ structuredContent: { sessionId: "s", topTurns: [] } }} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(port.calls).toHaveLength(0);
  });

  it("waits quietly when no result has arrived yet", () => {
    const port = new FakeAppHostPort();
    render(<SessionCostView port={port} brand={extension} result={undefined} />);
    expect(screen.getByRole("heading", { name: "Session cost" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for the session cost");
  });
});

describe("SessionCostView security (plan §6)", () => {
  it("never passes logged text to sendMessage or updateModelContext", async () => {
    const secret = "SECRET-PROMPT-TEXT api_key=abc123";
    const cost = sessionCost({ title: `Title ${secret}` });
    cost.topTurns[0]!.userMessage = secret;
    const { port } = setup({ cost });
    fireEvent.click(screen.getByRole("button", { name: /Turn 17/ }));
    await screen.findByText("Turn 17 · claude-sonnet-5.5");
    fireEvent.click(screen.getByRole("button", { name: "Copy title to open in panel" }));
    await screen.findByRole("button", { name: "Copied" });
    expect(screen.getAllByText(new RegExp(secret)).length).toBeGreaterThan(0); // shown to the user...
    const methods = new Set(port.calls.map((call) => call.method));
    expect(methods.has("sendMessage")).toBe(false); // ...but never forwarded
    expect(methods.has("updateModelContext")).toBe(false);
    expect(methods.has("openLink")).toBe(false);
    for (const call of calls(port, "callTool")) expect(JSON.stringify(call.args)).not.toContain("SECRET");
  });

  it("renders a hostile title, prompt and turn detail as inert text", async () => {
    const hostile = '<img src=x onerror="alert(1)">';
    const cost = sessionCost({ title: hostile });
    cost.topTurns[0]!.userMessage = hostile;
    const port = new FakeAppHostPort();
    port.toolResults.set("get_turn_series", { structuredContent: turnSeries() });
    port.toolResults.set("get_turn", { structuredContent: turnView({ userMessage: hostile }) });
    const { container } = render(<SessionCostView port={port} brand={extension} result={{ structuredContent: cost }} />);
    fireEvent.click(screen.getByRole("button", { name: /Turn 17/ }));
    await screen.findByText("Turn 17 · claude-sonnet-5.5");
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("heading", { name: hostile })).toBeInTheDocument();
    expect(screen.getAllByText(new RegExp(hostile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).length).toBeGreaterThanOrEqual(2);
  });

  // A14: every control, in the failure states too (Retry), with logged text
  // planted in every field the view shows.
  it("presses every control, through failures and retries, and forwards no logged text", async () => {
    const secret = "SECRET-LOGGED-TEXT";
    const cost = sessionCost({ title: `Title ${secret}` });
    for (const turn of cost.topTurns) turn.userMessage = `${secret} prompt ${turn.turnIndex}`;
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    // First with get_turn_series and get_turn failing (Retry everywhere)...
    const port = new FakeAppHostPort();
    const failingView = render(<SessionCostView port={port} brand={extension} clipboard={clipboard} result={{ structuredContent: cost }} />);
    await screen.findByRole("alert");
    const failing = await exerciseEveryControl();
    failingView.unmount();
    // ...then with both answering, so each turn opens and offers Hide turn.
    port.toolResults.set("get_turn_series", { structuredContent: turnSeries() });
    port.toolResults.set("get_turn", { structuredContent: turnView({ userMessage: `${secret} user`, assistantResponse: `${secret} reply`, explanation: `${secret} why` }) });
    render(<SessionCostView port={port} brand={extension} clipboard={clipboard} result={{ structuredContent: cost }} />);
    await screen.findByRole("img", { name: /AI Credits per turn/ });
    const working = await exerciseEveryControl();

    const pressed = [...failing, ...working];
    for (const name of ["button:Turn 17", "button:Turn 5", "button:Turn 29", "button:Retry", "button:Hide turn", 'button:Copy title to open in panel']) expect(pressed).toContain(name);
    expect(screen.getAllByText(new RegExp(secret)).length).toBeGreaterThan(0);
    expect(new Set(port.calls.map((call) => call.method))).toEqual(new Set(["callTool"]));
    expect(JSON.stringify(port.calls)).not.toContain(secret);
    // The clipboard gets the title (plan §4.4, decision A): it goes to the
    // user, who pastes it into the Open Session picker, never to the model.
    expect(clipboard.writeText.mock.calls).toEqual(clipboard.writeText.mock.calls.map(() => [`Title ${secret}`]));
    expect(clipboard.writeText).toHaveBeenCalled();
  });
});

describe("SessionCostView active session (plan §4.7)", () => {
  it("shows an active tag beside the meta line and a note when the server flags it", () => {
    setup({ cost: sessionCost({ active: true }) });
    const meta = screen.getByText("claude-sonnet-5.5 · 42 turns · Oct 27");
    expect(within(meta).getByText("active")).toHaveAttribute("title", "Latest turn started in the last 15 minutes; figures may still change");
    expect(screen.getByText("Active session: figures may still change; the latest turn may be incomplete.")).toBeInTheDocument();
  });

  it("shows neither when the session is not active", () => {
    setup();
    expect(screen.queryByText("active")).not.toBeInTheDocument();
    expect(screen.queryByText(/Active session/)).not.toBeInTheDocument();
  });
});
