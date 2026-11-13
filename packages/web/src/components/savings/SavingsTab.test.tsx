// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SavingsReport } from "@agent-cost-analyzer/domain";
import type { SavingsQuery } from "../../api-client/savings.js";
import { IDLE_CACHE, makeSavingsReport, opportunity, SAVINGS_FIXTURE_NOW, UNPRICED_ROW, UNUSED_TOOLS } from "../../test-support/savings-fixture.js";
import { SavingsTab } from "./SavingsTab.js";

// Phase 16 SR14: the Savings tab against the SR11 boards. Honesty labels are
// asserted as text (plan §7), amounts are per currency and never added, and
// log-derived names are rendered as text.

const PROVIDERS = [
  { id: "vscode", label: "GitHub Copilot, VS Code" },
  { id: "claude-code", label: "Claude Code" },
];

function renderTab(props: Partial<Parameters<typeof SavingsTab>[0]> = {}) {
  const loadReport = props.loadReport ?? vi.fn().mockResolvedValue(makeSavingsReport());
  const copyMock = vi.fn().mockResolvedValue(undefined);
  const copyToClipboard = props.copyToClipboard ?? copyMock;
  const onOpenSession = props.onOpenSession ?? vi.fn();
  const view = render(
    <SavingsTab now={SAVINGS_FIXTURE_NOW} providers={PROVIDERS} openSessionLabel="Open in Analyze" {...props} loadReport={loadReport} copyToClipboard={copyToClipboard} onOpenSession={onOpenSession} />,
  );
  return { loadReport, copyToClipboard: copyMock, onOpenSession, ...view };
}

async function ready() {
  await screen.findByRole("heading", { name: "AI Credits" });
}

// The row whose subject (a model, server, tool or program name) is `subject`.
function rowOf(subject: string) {
  const row = screen.getAllByTestId("savings-row").find((candidate) => candidate.querySelector(".savings-subject-text")?.textContent === subject);
  if (!row) throw new Error(`no row for ${subject}`);
  return row;
}

describe("SavingsTab: the request", () => {
  it("asks for the last 30 days, as of use, without simulated savings", async () => {
    const { loadReport } = renderTab();
    await ready();

    expect(loadReport).toHaveBeenCalledWith({ since: "2026-10-14", pricing: "as-of-use", includeSimulated: false }, expect.any(AbortSignal));
  });

  it("re-asks when the window, provider, prices or Include simulated change", async () => {
    const { loadReport } = renderTab();
    await ready();

    fireEvent.change(screen.getByLabelText("Window"), { target: { value: "90" } });
    await waitFor(() => expect(loadReport).toHaveBeenLastCalledWith(expect.objectContaining({ since: "2026-08-15" }), expect.any(AbortSignal)));
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "claude-code" } });
    await waitFor(() => expect(loadReport).toHaveBeenLastCalledWith(expect.objectContaining({ provider: "claude-code" }), expect.any(AbortSignal)));
    fireEvent.change(screen.getByLabelText("Prices"), { target: { value: "today" } });
    await waitFor(() => expect(loadReport).toHaveBeenLastCalledWith(expect.objectContaining({ pricing: "today" }), expect.any(AbortSignal)));
    fireEvent.click(screen.getByRole("checkbox", { name: "Include simulated" }));
    await waitFor(() => expect(loadReport).toHaveBeenLastCalledWith(expect.objectContaining({ includeSimulated: true }), expect.any(AbortSignal)));
  });

  it("has Include simulated off by default", async () => {
    renderTab();
    await ready();

    expect(screen.getByRole("checkbox", { name: "Include simulated" })).not.toBeChecked();
  });

  it("has no Provider filter in the extension, which reads GitHub Copilot sessions only, and says where the rest are", async () => {
    renderTab({ copilotOnly: true });
    await ready();

    expect(screen.queryByLabelText("Provider")).not.toBeInTheDocument();
    expect(screen.getByText("GitHub Copilot sessions only")).toBeInTheDocument();
    expect(screen.getByText(/Claude Code and pi savings are in the standalone app\./)).toBeInTheDocument();
  });

  it("Refresh asks again", async () => {
    const { loadReport } = renderTab();
    await ready();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(loadReport).toHaveBeenCalledTimes(2));
  });
});

describe("SavingsTab: ranked lists (D3, D4)", () => {
  it("shows one ranked list per currency, AI Credits then US dollars, with no grand total", async () => {
    renderTab();
    await ready();

    const headings = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
    expect(headings.slice(0, 2)).toEqual(["AI Credits", "US dollars"]);
    const credits = screen.getByRole("list", { name: "AI Credits" });
    expect(within(credits).getAllByTestId("savings-row").map((row) => row.querySelector(".savings-rank")?.textContent)).toEqual(["1", "2", "3", ""]);
    const dollars = screen.getByRole("list", { name: "US dollars" });
    expect(within(dollars).getAllByTestId("savings-row")).toHaveLength(1);
    expect(screen.queryByText(/total/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Opportunities overlap, so they are not added up\./)).toBeInTheDocument();
  });

  it("states the window, that amounts are per week, and how they are ranked", async () => {
    renderTab();
    await ready();

    expect(screen.getByText(/Oct 15 – Nov 13, 30 days\. Amounts are per week \(30 days ÷ 4\.3\)\. Changes are ranked by the high end; the low end sits beside it\./)).toBeInTheDocument();
  });

  it("labels ranges, upper bounds, inferred, estimate and unpriced rows in words", async () => {
    renderTab();
    await ready();

    expect(rowOf("claude-sonnet-5.5")).toHaveTextContent("up to 46.0 AI Credits per week");
    const tools = rowOf("github");
    expect(tools).toHaveTextContent("6.2–38.4 AI Credits per week");
    expect(within(tools).getByText("inferred")).toBeInTheDocument();
    expect(within(tools).getByText("estimate")).toBeInTheDocument();
    expect(rowOf("claude-opus-5.5")).toHaveTextContent("up to $3.20 per week");
    const unpriced = rowOf("git");
    expect(unpriced).toHaveTextContent("Not priced");
    expect(unpriced).toHaveTextContent("no price for gpt-5.1-codex on 2026-10-22");
    expect(unpriced.textContent).not.toMatch(/\b0\.0\b/);
  });

  it("shows coverage on every row", async () => {
    renderTab();
    await ready();

    for (const row of screen.getAllByTestId("savings-row")) {
      expect(row.textContent).toMatch(/\d+ of \d+ sessions/);
    }
    expect(rowOf("claude-sonnet-5.5")).toHaveTextContent("38 of 41 sessions; 3 not analysed: no request trace");
  });

  it("draws bars with a caption that they compare rows in their own list only", async () => {
    renderTab();
    await ready();

    expect(screen.getAllByText("Bars compare rows in this list only.")).toHaveLength(2);
    const bar = rowOf("github").querySelector(".savings-bar")!;
    expect(bar).toHaveAttribute("aria-hidden", "true");
    expect(bar.querySelector(".savings-bar-sure")).not.toBeNull();
    expect(bar.querySelector(".savings-bar-maybe")).not.toBeNull();
    expect(rowOf("git").querySelector(".savings-bar")).toBeNull();
  });

  it("lists the rows of a currency in the server's order and keeps the unpriced one last, unranked", async () => {
    renderTab({ loadReport: vi.fn().mockResolvedValue(makeSavingsReport({ opportunities: [UNPRICED_ROW, IDLE_CACHE] })) });
    await ready();

    const rows = screen.getAllByTestId("savings-row");
    expect(rows[0]).toHaveTextContent("claude-sonnet-5.5");
    expect(rows[1]).toHaveTextContent("git");
  });
});

describe("SavingsTab: Simulated and Not analysed", () => {
  it("keeps Simulated savings in their own section, per week, labelled, unranked", async () => {
    renderTab();
    await ready();

    const section = screen.getByRole("region", { name: "Simulated" });
    expect(section).toHaveTextContent("Replays on another model. Not ranked.");
    const row = within(section).getByTestId("savings-row");
    expect(row).toHaveTextContent("3.1–3.6 AI Credits per week");
    expect(within(row).getByText("Simulated")).toBeInTheDocument();
    expect(row.querySelector(".savings-rank")).toBeNull();
    expect(within(screen.getByRole("list", { name: "AI Credits" })).queryByText("claude-haiku-5.5")).not.toBeInTheDocument();
  });

  it("has no Simulated section when there are none", async () => {
    renderTab({ loadReport: vi.fn().mockResolvedValue(makeSavingsReport({ simulated: [] })) });
    await ready();

    expect(screen.queryByRole("region", { name: "Simulated" })).not.toBeInTheDocument();
  });

  it("lists what was not analysed, with the reason, and says no saving is claimed for it", async () => {
    renderTab();
    await ready();

    const section = screen.getByRole("region", { name: "Not analysed" });
    expect(section).toHaveTextContent("No row below was checked, so no saving is claimed for it.");
    expect(section).toHaveTextContent("Tools loaded but never used");
    expect(section).toHaveTextContent("Claude Code");
    expect(section).toHaveTextContent("the logs hold no tool inventory");
    expect(section).toHaveTextContent("14 sessions");
  });
});

describe("SavingsTab: detail", () => {
  it("opens the detail of a row with its amount, evidence, coverage and the labels", async () => {
    renderTab();
    await ready();

    fireEvent.click(within(rowOf("github")).getByRole("button"));

    const detail = screen.getByRole("region", { name: "Savings detail" });
    expect(detail).toHaveTextContent("Tools loaded but never used");
    expect(detail).toHaveTextContent("6.2–38.4 AI Credits per week");
    expect(detail).toHaveTextContent("Over the 30 days: 26.7–165.1 AI Credits.");
    expect(detail).toHaveTextContent("Priced from the price book: what the same tokens would cost another way. It cannot be billed.");
    expect(detail).toHaveTextContent("The low end is the likely figure");
    expect(within(detail).getByText("inferred")).toBeInTheDocument();
    expect(detail).toHaveTextContent("877");
    expect(detail).toHaveTextContent("5,400");
    expect(within(detail).getByText("estimate")).toBeInTheDocument();
    expect(detail).toHaveTextContent("31 of 41 sessions; 10 not analysed: no tool inventory");
    expect(detail).toHaveTextContent("The group is read from names in the log, so it is a guess.");
  });

  it("says an upper bound claims no lower end, and shows unknown counts as Unknown with the reason", async () => {
    renderTab();
    await ready();

    fireEvent.click(within(rowOf("rg")).getByRole("button"));

    const detail = screen.getByRole("region", { name: "Savings detail" });
    expect(detail).toHaveTextContent("No lower bound is claimed. Over the 30 days: up to 42.1 AI Credits.");
    expect(detail).toHaveTextContent("Unknown");
    expect(detail).toHaveTextContent("no token count in the log");
  });

  it("shows the action text with thousands separators, and says it is a suggestion only", async () => {
    renderTab();
    await ready();

    fireEvent.click(within(rowOf("github")).getByRole("button"));

    const detail = screen.getByRole("region", { name: "Savings detail" });
    expect(detail).toHaveTextContent("Turn off the tools of github in the tool picker (23 tools, about 5,400 tokens on each request); none of them ran in 31 sessions over 30 days.");
    expect(detail).toHaveTextContent("Suggestion only. This app does not change settings or files.");
  });

  it("copies the fixed action text, folded to one line", async () => {
    const { copyToClipboard } = renderTab();
    await ready();
    fireEvent.click(within(rowOf("github")).getByRole("button"));

    fireEvent.click(screen.getByRole("button", { name: "Copy text" }));

    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledTimes(1));
    const copied = copyToClipboard.mock.calls[0]![0] as string;
    expect(copied).toMatch(/^Turn off the tools of github in the tool picker \(23 tools, about 5,400 tokens/);
    expect(copied).not.toMatch(/[\n\r\t]/);
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("says when the copy failed, and shows no 'Copied'", async () => {
    renderTab({ copyToClipboard: vi.fn().mockRejectedValue(new Error("denied")) });
    await ready();
    fireEvent.click(within(rowOf("github")).getByRole("button"));

    fireEvent.click(screen.getByRole("button", { name: "Copy text" }));

    expect(await screen.findByText("Copy failed: select the text above by hand.")).toBeInTheDocument();
    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
  });

  it("links the sessions into Analyze, a few at a time, with the host's wording", async () => {
    const { onOpenSession } = renderTab();
    await ready();
    fireEvent.click(within(rowOf("github")).getByRole("button"));

    const detail = screen.getByRole("region", { name: "Savings detail" });
    const links = within(detail).getAllByRole("button", { name: /^Open in Analyze/ });
    expect(links).toHaveLength(5);
    expect(detail).toHaveTextContent("and 3 more");
    fireEvent.click(links[1]!);
    expect(onOpenSession).toHaveBeenCalledWith({ providerId: "vscode", sessionId: "session-2" });
  });

  it("says 'Open session' in the extension", async () => {
    renderTab({ openSessionLabel: "Open session" });
    await ready();
    fireEvent.click(within(rowOf("github")).getByRole("button"));

    expect(within(screen.getByRole("region", { name: "Savings detail" })).getAllByRole("button", { name: /^Open session/ })).not.toHaveLength(0);
  });

  it("collapses the price versions until asked", async () => {
    renderTab();
    await ready();
    fireEvent.click(within(rowOf("github")).getByRole("button"));

    const disclosure = screen.getByText("Price versions (1)").closest("details")!;
    expect(disclosure).not.toHaveAttribute("open");
    expect(disclosure).toHaveTextContent("github-copilot@2026-10-01");
  });

  it("shows a Simulated detail per session, with the self-check, coverage and assumption A1", async () => {
    renderTab();
    await ready();

    fireEvent.click(within(screen.getByRole("region", { name: "Simulated" })).getByRole("button", { name: /claude-haiku-5\.5/ }));

    const detail = screen.getByRole("region", { name: "Savings detail" });
    expect(detail).toHaveTextContent("2.7–3.1 AI Credits per session (5 sessions)");
    expect(detail).toHaveTextContent("Simulated: a replay on another model, not a billed amount.");
    expect(detail).toHaveTextContent("passed: the replay on the session's own model matches the log for 62 of 64 requests (97%)");
    expect(detail).toHaveTextContent("replayed 61 of 64 requests");
    expect(detail).toHaveTextContent("A1. The replay assumes the same conversation");
    expect(detail).toHaveTextContent("would not have answered the same way");
  });

  it("closes the detail with the Close button and returns focus to its row", async () => {
    renderTab();
    await ready();
    const rowButton = within(rowOf("github")).getByRole("button");
    fireEvent.click(rowButton);

    fireEvent.click(screen.getByRole("button", { name: "Close detail" }));

    expect(screen.queryByRole("region", { name: "Savings detail" })).not.toBeInTheDocument();
    expect(rowButton).toHaveFocus();
  });

  it("says when the detector's parameters do not fit the template, instead of guessing", async () => {
    renderTab({ loadReport: vi.fn().mockResolvedValue(makeSavingsReport({ opportunities: [{ ...UNUSED_TOOLS, actionParams: {} }], simulated: [] })) });
    await ready();
    fireEvent.click(within(rowOf("github")).getByRole("button"));

    expect(screen.getByText("No action text is available for this row.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy text" })).not.toBeInTheDocument();
  });
});

describe("SavingsTab: keyboard", () => {
  it("opens a row with Enter and Space, and moves through rows with Tab", async () => {
    const user = userEvent.setup();
    renderTab();
    await ready();

    await user.tab(); // Window
    await user.tab(); // Provider
    await user.tab(); // Prices
    await user.tab(); // Include simulated
    await user.tab(); // Refresh
    await user.tab(); // first row
    expect(within(rowOf("claude-sonnet-5.5")).getByRole("button")).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("region", { name: "Savings detail" })).toHaveTextContent("Cache lost after an idle gap");
    await user.tab();
    expect(within(rowOf("github")).getByRole("button")).toHaveFocus();
    await user.keyboard(" ");
    expect(screen.getByRole("region", { name: "Savings detail" })).toHaveTextContent("Tools loaded but never used");
  });

  it("closes the detail with Escape", async () => {
    const user = userEvent.setup();
    renderTab();
    await ready();
    await user.click(within(rowOf("github")).getByRole("button"));

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("region", { name: "Savings detail" })).not.toBeInTheDocument();
  });
});

describe("SavingsTab: hostile names are text", () => {
  it("renders a tool, server and program name as text in the row, the detail and the not-analysed list", async () => {
    const hostile = `<img src=x onerror="alert(1)"><script>window.pwned=1</script>`;
    const report = makeSavingsReport({
      opportunities: [
        opportunity({ key: "h1", kind: "unused-tools", subject: hostile, actionParams: { group: hostile, tools: 1, tokens: 1, sessions: 1, days: 30 } }),
        opportunity({ key: "h2", kind: "failed-tool-calls", subject: hostile, perWeek: UNPRICED_ROW.perWeek, perWindow: UNPRICED_ROW.perWindow, actionParams: { name: hostile, calls: 2, sessions: 1, category: "x" } }),
      ],
      simulated: [],
      notAnalysed: [{ kind: "failed-tool-calls", providerId: "vscode", reason: hostile, sessions: 1 }],
    });
    const { container } = renderTab({ loadReport: vi.fn().mockResolvedValue(report) });
    await ready();
    fireEvent.click(within(screen.getAllByTestId("savings-row")[0]!).getByRole("button"));

    expect(container.querySelector("img, script")).toBeNull();
    expect(screen.getAllByText(hostile, { exact: false }).length).toBeGreaterThan(2);
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
  });
});

describe("SavingsTab: states", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("shows loading with Cancel, then the cancelled state with Run again", async () => {
    const loadReport = vi.fn((_query: SavingsQuery, signal: AbortSignal) => new Promise<SavingsReport>((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))));
    renderTab({ loadReport });

    expect(screen.getByRole("status")).toHaveTextContent("Building the savings report…");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(await screen.findByText("Cancelled")).toBeInTheDocument();
    expect(screen.getByText(/Nothing is shown, because a partial list would misrank the changes\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run again" }));
    expect(loadReport).toHaveBeenCalledTimes(2);
  });

  it("shows an error with the reason and Retry", async () => {
    const loadReport = vi.fn().mockRejectedValueOnce(new Error("The server did not answer")).mockResolvedValue(makeSavingsReport());
    renderTab({ loadReport });

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not build the report.");
    expect(screen.getByRole("alert")).toHaveTextContent("The server did not answer");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await ready();
  });

  it("shows an empty window with a way to widen it", async () => {
    const loadReport = vi.fn().mockResolvedValue(makeSavingsReport({ opportunities: [], simulated: [], notAnalysed: [] }));
    renderTab({ loadReport });

    expect(await screen.findByText("Nothing to report in the last 30 days")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use 90 days" }));

    await waitFor(() => expect(loadReport).toHaveBeenLastCalledWith(expect.objectContaining({ since: "2026-08-15" }), expect.any(AbortSignal)));
  });

  it("says nothing was found when sessions were checked but no row is left, and still lists what was not analysed", async () => {
    renderTab({ loadReport: vi.fn().mockResolvedValue(makeSavingsReport({ opportunities: [], simulated: [] })) });

    expect(await screen.findByText("Nothing found in the analysed sessions")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Not analysed" })).toBeInTheDocument();
  });

  it("warns once per report about sessions left out, as partial data", async () => {
    renderTab({
      loadReport: vi.fn().mockResolvedValue(
        makeSavingsReport({
          sessionsLeftOut: [
            { providerId: "vscode", reason: "over the session limit", sessions: 12 },
            { providerId: "claude-code", reason: "log could not be read", sessions: 2 },
          ],
        }),
      ),
    });
    await ready();

    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("Partial data.");
    expect(note).toHaveTextContent("12 sessions of GitHub Copilot, VS Code left out: over the session limit");
    expect(note).toHaveTextContent("2 sessions of Claude Code left out: log could not be read");
    expect(screen.getAllByRole("note")).toHaveLength(1);
  });

  it("says every amount is unknown, not zero, when no row is priced", async () => {
    renderTab({ loadReport: vi.fn().mockResolvedValue(makeSavingsReport({ opportunities: [UNPRICED_ROW], simulated: [], notAnalysed: [] })) });
    await ready();

    expect(screen.getByText(/No price in the price book for the models in these sessions, so no amount is claimed\. The counts are real; the amounts are not zero, they are unknown\./)).toBeInTheDocument();
    expect(screen.getByText(/GitHub Copilot, VS Code · 1 change, none priced/)).toBeInTheDocument();
  });
});

describe("SavingsTab: narrow (320 px)", () => {
  const original = globalThis.ResizeObserver;
  afterEach(() => {
    globalThis.ResizeObserver = original;
  });

  function narrowObserver() {
    globalThis.ResizeObserver = class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe() {
        this.callback([{ contentRect: { width: 320 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      disconnect() {}
      unobserve() {}
    };
  }

  // SR16: the row that had focus is gone once the detail replaces the list,
  // so focus moves to the detail's Back button instead of the page.
  it("moves focus into the detail when it replaces the list", async () => {
    narrowObserver();
    const user = userEvent.setup();
    renderTab();
    await ready();

    await user.click(within(rowOf("github")).getByRole("button"));

    expect(screen.getByRole("button", { name: "Back to the list" })).toHaveFocus();
  });

  it("replaces the list with the detail, and Back returns to the list", async () => {
    globalThis.ResizeObserver = class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe() {
        this.callback([{ contentRect: { width: 320 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      disconnect() {}
      unobserve() {}
    };
    renderTab();
    await ready();

    fireEvent.click(within(rowOf("github")).getByRole("button"));

    expect(screen.getByRole("region", { name: "Savings detail" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "AI Credits" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to the list" }));
    expect(screen.getByRole("list", { name: "AI Credits" })).toBeInTheDocument();
    expect(within(rowOf("github")).getByRole("button")).toHaveFocus();
  });
});
