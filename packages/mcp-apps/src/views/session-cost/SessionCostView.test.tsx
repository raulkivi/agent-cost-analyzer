import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FakeAppHostPort } from "../../host/fake-app-host-port.js";
import type { ClipboardPort } from "../../host/clipboard-port.js";
import type { ViewBrand } from "../../brand/view-brand.js";
import { sessionCost, total, turnSeries, measures } from "../../view-models/fixtures.js";
import { turnView } from "../../view-models/turn-view-fixture.js";
import { SessionCostView } from "../SessionCostView.js";

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
    const chart = await screen.findByRole("img", { name: "AI Credits per turn, 4 turns" });
    expect(calls(port, "callTool")[0]!.args).toEqual(["get_turn_series", { sessionId: "7f3a9c2e" }]);
    expect(screen.getByText("1 turn unknown")).toBeInTheDocument();
    expect(within(chart).getByText("Turn 2: 4.10 AI Credits (estimate), compaction, model switch")).toBeInTheDocument();
    expect(within(chart).getByText("Turn 1: Unknown")).toBeInTheDocument();
    expect(chart.querySelectorAll("[data-event]").length).toBe(1);
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

  it("shows Unknown for an unknown top turn, and draws an unknown chart turn as a gap (not a zero bar)", async () => {
    setup();
    const row = within(screen.getByRole("table", { name: "Top turns by AI Credits" })).getAllByRole("row")[3]!;
    expect(within(row).getAllByText("Unknown")).toHaveLength(2);
    const chart = await screen.findByRole("img", { name: /AI Credits per turn/ });
    expect(chart.querySelectorAll("[data-unknown]")).toHaveLength(1);
    expect(chart.querySelector("[data-unknown]")!.getAttribute("fill")).toContain("url(#");
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
    expect(await screen.findByRole("img", { name: "AI Credits per turn, 4 turns" })).toBeInTheDocument();
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

describe("SessionCostView copy-command button", () => {
  it("copies the Command Palette text and shows short Copied feedback", async () => {
    const { clipboard, port } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Copy .open in panel. command/ }));
    await waitFor(() => expect(clipboard!.writeText).toHaveBeenCalledWith("AI Credits Analyzer: Open Session 7f3a9c2e"));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Paste it in the Command Palette");
    expect(calls(port, "openLink")).toHaveLength(0);
  });

  it("returns to the idle label after a moment", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      setup();
      fireEvent.click(screen.getByRole("button", { name: /Copy .open in panel. command/ }));
      await screen.findByRole("button", { name: "Copied" });
      await act(async () => {});
      act(() => vi.advanceTimersByTime(3000));
      expect(screen.getByRole("button", { name: /Copy .open in panel. command/ })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("says so, and shows the text to copy by hand, when the clipboard write fails", async () => {
    setup({ clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    fireEvent.click(screen.getByRole("button", { name: /Copy .open in panel. command/ }));
    expect(await screen.findByRole("status")).toHaveTextContent("Couldn't copy");
    expect(screen.getByText("AI Credits Analyzer: Open Session 7f3a9c2e")).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: /Copy .open in panel. command/ }));
    await screen.findByRole("button", { name: "Copied" });
    expect(screen.getAllByText(new RegExp(secret)).length).toBeGreaterThan(0); // shown to the user...
    const methods = new Set(port.calls.map((call) => call.method));
    expect(methods.has("sendMessage")).toBe(false); // ...but never forwarded
    expect(methods.has("updateModelContext")).toBe(false);
    expect(methods.has("openLink")).toBe(false);
    for (const call of calls(port, "callTool")) expect(JSON.stringify(call.args)).not.toContain("SECRET");
  });
});
