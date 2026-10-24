import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { sampleInsightsDataset } from "../../test-support/insights-fixture.js";
import { InsightsDashboard } from "./InsightsDashboard.js";

const NOW = new Date("2026-10-11T12:00:00.000Z");

function renderDashboard(loadDataset = vi.fn().mockResolvedValue(sampleInsightsDataset())) {
  render(<InsightsDashboard loadDataset={loadDataset} now={NOW} />);
  return { loadDataset };
}

function tile(name: string) {
  return screen.getByRole("group", { name });
}

function option(listBox: string, name: RegExp) {
  return within(screen.getByRole("listbox", { name: listBox })).getByRole("option", { name });
}

describe("InsightsDashboard", () => {
  it("loads the last 30 days across all providers and shows KPIs with coverage", async () => {
    const { loadDataset } = renderDashboard();

    expect(await screen.findByRole("group", { name: "AI Credits" })).toHaveTextContent("5.50");
    expect(loadDataset).toHaveBeenCalledWith({ since: "2026-09-11", limit: 200 }, expect.any(AbortSignal));
    expect(tile("AI Credits")).toHaveTextContent("3 of 4 turns known");
    expect(tile("Sessions")).toHaveTextContent("3");
    expect(tile("Cache hit ratio")).toHaveTextContent("80%");
    expect(tile("Failure rate")).toHaveTextContent("50%");
    expect(tile("Security signals")).toHaveTextContent("1");
  });

  it("explains what happened in plain language", async () => {
    renderDashboard();
    const summary = await screen.findByRole("region", { name: "What happened" });
    expect(summary).toHaveTextContent("3 sessions across Claude Code and VS Code, 2026-10-09 → 2026-10-10.");
    expect(summary).toHaveTextContent("Signals to review: 1 critical.");
  });

  it("reports providers that could not be read", async () => {
    renderDashboard();
    expect(await screen.findByText(/pi: No sessions directory/)).toBeInTheDocument();
  });

  it("a list-box click filters every KPI, chart and list box associatively", async () => {
    renderDashboard();
    await screen.findByRole("group", { name: "AI Credits" });

    fireEvent.click(option("Program", /npm/));

    expect(tile("Sessions")).toHaveTextContent("1");
    expect(tile("AI Credits")).toHaveTextContent("0.50");
    expect(option("Provider", /VS Code/)).toHaveAttribute("data-state", "possible");
    expect(option("Provider", /Claude Code/)).toHaveAttribute("data-state", "excluded");
    expect(option("Program", /curl/)).toHaveAttribute("data-state", "alternative");
    expect(screen.getByRole("listitem", { name: "Program: npm" })).toBeInTheDocument();
  });

  it("Back undoes the last selection and Clear all removes every one", async () => {
    renderDashboard();
    await screen.findByRole("group", { name: "AI Credits" });

    fireEvent.click(option("Provider", /Claude Code/));
    fireEvent.click(option("Severity", /Critical/));
    expect(tile("Sessions")).toHaveTextContent("1");

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(tile("Sessions")).toHaveTextContent("2");

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(tile("Sessions")).toHaveTextContent("3");
  });

  it("selects a session from the signals table", async () => {
    renderDashboard();
    fireEvent.click(await screen.findByRole("button", { name: "Fix tests · turn 0" }));

    expect(tile("Sessions")).toHaveTextContent("1");
    expect(screen.getByRole("listitem", { name: "Session: Fix tests" })).toBeInTheDocument();
  });

  it("selects a day by clicking its column", async () => {
    renderDashboard();
    fireEvent.click(await screen.findByRole("button", { name: /^10-09: 5\.00/ }));

    expect(tile("Sessions")).toHaveTextContent("1");
    expect(screen.getByRole("listitem", { name: "Date: 2026-10-09" })).toBeInTheDocument();
  });

  it("never charts a day whose AI Credits are all unknown as 0", async () => {
    const dataset = sampleInsightsDataset();
    renderDashboard(vi.fn().mockResolvedValue({ ...dataset, turns: dataset.turns.map((turn) => ({ ...turn, aiCredits: null })) }));

    expect(await screen.findByText("No known AI Credits in the current selection.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^10-09:/ })).not.toBeInTheDocument();
  });

  it("reloads for another range and drops the selections", async () => {
    const { loadDataset } = renderDashboard();
    await screen.findByRole("group", { name: "AI Credits" });
    fireEvent.click(option("Provider", /VS Code/));

    fireEvent.click(screen.getByLabelText("All time"));

    await waitFor(() => expect(loadDataset).toHaveBeenLastCalledWith({ limit: 200 }, expect.any(AbortSignal)));
    await waitFor(() => expect(screen.queryByRole("listitem", { name: /Provider/ })).not.toBeInTheDocument());
  });

  it("shows a load error", async () => {
    renderDashboard(vi.fn().mockRejectedValue(new Error("boom")));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load insights: boom");
  });

  // §3.5 States (AsyncView).
  it("retries a failed load", async () => {
    const { loadDataset } = renderDashboard(
      vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(sampleInsightsDataset()),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("group", { name: "AI Credits" })).toHaveTextContent("5.50");
    expect(loadDataset).toHaveBeenCalledTimes(2);
  });

  it("offers all time as the empty range's next step", async () => {
    const { loadDataset } = renderDashboard(
      vi.fn().mockResolvedValue({ ...sampleInsightsDataset(), sessions: [], turns: [], toolCalls: [], findings: [] }),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Show all time" }));

    await waitFor(() => expect(loadDataset).toHaveBeenLastCalledWith({ limit: 200 }, expect.any(AbortSignal)));
  });

  it("warns, as partial data, when a provider failed to load or was cut short", async () => {
    const dataset = sampleInsightsDataset();
    renderDashboard(
      vi.fn().mockResolvedValue({
        ...dataset,
        providers: dataset.providers.map((provider, index) => (index === 0 ? { ...provider, error: "locked" } : provider)),
      }),
    );

    expect(await screen.findByRole("note")).toHaveTextContent(/Partial data.*failed to load \(locked\)/);
  });

  it("shows an empty state when no provider has sessions", async () => {
    renderDashboard(vi.fn().mockResolvedValue({ ...sampleInsightsDataset(), sessions: [], turns: [], toolCalls: [], findings: [] }));
    expect(await screen.findByText(/No sessions in this date range/)).toBeInTheDocument();
  });

  // vscode-extension.md G10: the extension reads one provider, so the
  // dashboard drops the provider facet and the cross-provider wording.
  describe("crossProvider", () => {
    function renderSingleProvider(loadDataset = vi.fn().mockResolvedValue(sampleInsightsDataset())) {
      render(<InsightsDashboard loadDataset={loadDataset} now={NOW} crossProvider={false} />);
    }

    it("titles itself across all providers by default (standalone)", async () => {
      renderDashboard();
      await screen.findByRole("group", { name: "AI Credits" });

      expect(screen.getByRole("heading", { name: "Insights across all providers" })).toBeInTheDocument();
      expect(screen.getByRole("listbox", { name: "Provider" })).toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: "Provider" })).toBeInTheDocument();
    });

    it("has no provider wording, Provider list box or Provider column when false", async () => {
      renderSingleProvider();
      expect(screen.getByText("Loading sessions…")).toBeInTheDocument();
      await screen.findByRole("group", { name: "AI Credits" });

      expect(screen.getByRole("heading", { name: "Insights" })).toBeInTheDocument();
      expect(screen.queryByText(/all providers|every provider|any provider/)).not.toBeInTheDocument();
      expect(screen.queryByRole("listbox", { name: "Provider" })).not.toBeInTheDocument();
      expect(screen.getByRole("listbox", { name: "Date" })).toBeInTheDocument();
      expect(screen.queryByRole("columnheader", { name: "Provider" })).not.toBeInTheDocument();
      expect(screen.getByRole("region", { name: "What happened" })).toHaveTextContent("3 sessions, 2026-10-09 → 2026-10-10.");
    });

    it("has a provider-free empty state when false", async () => {
      renderSingleProvider(vi.fn().mockResolvedValue({ ...sampleInsightsDataset(), sessions: [], turns: [], toolCalls: [], findings: [] }));

      expect(await screen.findByText("No sessions in this date range.")).toBeInTheDocument();
    });
  });

  it("lets a slow load be cancelled, says so without an error alert, and retries", async () => {
    const user = userEvent.setup();
    const signals: AbortSignal[] = [];
    const loadDataset = vi.fn((_query: unknown, signal: AbortSignal) => {
      signals.push(signal);
      return signals.length === 1 ? new Promise<never>(() => undefined) : Promise.resolve(sampleInsightsDataset());
    });
    render(<InsightsDashboard loadDataset={loadDataset} now={NOW} />);

    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(signals[0].aborted).toBe(true);
    expect(screen.getByRole("heading", { name: "Loading cancelled" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("group", { name: "AI Credits" })).toBeInTheDocument();
    expect(loadDataset).toHaveBeenCalledTimes(2);
  });
});
