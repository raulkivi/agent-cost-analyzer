// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { sampleCostComparison, sampleCostSeries, sampleCostVariance, sampleProjectCost } from "../../test-support/cost-fixture.js";
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

  describe("attribution list boxes (step 15.4)", () => {
    it("shows Project, Repository, Vendor and Channel list boxes first, with No project and Unattributed", async () => {
      renderDashboard();
      await screen.findByRole("group", { name: "AI Credits" });

      const listBoxes = screen.getAllByRole("listbox").map((listBox) => listBox.getAttribute("aria-label"));
      expect(listBoxes.slice(0, 4)).toEqual(["Project", "Repository", "Vendor", "Channel"]);
      expect(option("Project", /No project/)).toBeInTheDocument();
      expect(option("Repository", /Unattributed/)).toBeInTheDocument();
      expect(option("Vendor", /OpenAI/)).toBeInTheDocument();
      expect(option("Channel", /GitHub Copilot/)).toBeInTheDocument();
    });

    it("filters every KPI by project, counting only the turns in it", async () => {
      renderDashboard();
      await screen.findByRole("group", { name: "AI Credits" });

      fireEvent.click(option("Project", /Customer portal/));

      expect(tile("AI Credits")).toHaveTextContent("2.50");
      expect(tile("Turns")).toHaveTextContent("2");
      expect(tile("Sessions")).toHaveTextContent("2");
      expect(option("Repository", /github.com\/acme\/platform/)).toHaveAttribute("data-state", "excluded");
      expect(screen.getByRole("listitem", { name: "Project: Customer portal" })).toBeInTheDocument();
      const table = screen.getByRole("table", { name: "Most expensive sessions" });
      expect(within(table).getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell").at(-1)?.textContent)).toEqual([
        "2.00",
        "0.50",
      ]);
    });

    it("filters by repository, and Unattributed keeps its turns' unknown AI Credits unknown", async () => {
      renderDashboard();
      await screen.findByRole("group", { name: "AI Credits" });

      fireEvent.click(option("Repository", /Unattributed/));

      expect(tile("AI Credits")).toHaveTextContent("—");
      expect(tile("AI Credits")).toHaveTextContent("0 of 1 turns known");
      expect(option("Project", /No project/)).toHaveAttribute("data-state", "possible");
    });

    it("selects and adds values with the keyboard alone", async () => {
      const user = userEvent.setup();
      renderDashboard();
      await screen.findByRole("group", { name: "AI Credits" });

      option("Vendor", /OpenAI/).focus();
      await user.keyboard("{Enter}");
      expect(tile("Sessions")).toHaveTextContent("1");

      option("Vendor", /Anthropic/).focus();
      await user.keyboard("{Control>} {/Control}");
      expect(option("Vendor", /Anthropic/)).toHaveAttribute("aria-selected", "true");
      expect(option("Vendor", /OpenAI/)).toHaveAttribute("aria-selected", "true");
      expect(tile("Sessions")).toHaveTextContent("3");

      await user.click(screen.getByRole("button", { name: "Clear Vendor selection" }));
      expect(screen.queryByRole("listitem", { name: /^Vendor/ })).not.toBeInTheDocument();
    });

    it("reaches the new list boxes' values with Tab", async () => {
      const user = userEvent.setup();
      renderDashboard();
      await screen.findByRole("group", { name: "AI Credits" });

      const first = option("Project", /Customer portal/);
      for (let step = 0; step < 40 && document.activeElement !== first; step++) {
        await user.tab();
      }
      expect(document.activeElement).toBe(first);
      await user.keyboard(" ");
      expect(screen.getByRole("listitem", { name: "Project: Customer portal" })).toBeInTheDocument();
    });
  });

  describe("cost basis (step 15.6)", () => {
    it("shows a Cost basis list box after Channel, with each turn's preferred basis", async () => {
      renderDashboard();
      await screen.findByRole("group", { name: "AI Credits" });

      const listBoxes = screen.getAllByRole("listbox").map((listBox) => listBox.getAttribute("aria-label"));
      expect(listBoxes.slice(0, 5)).toEqual(["Project", "Repository", "Vendor", "Channel", "Cost basis"]);
      expect(within(screen.getByRole("listbox", { name: "Cost basis" })).getAllByRole("option").map((o) => o.textContent)).toEqual([
        expect.stringContaining("Billed"),
        expect.stringContaining("Reported"),
        expect.stringContaining("Priced"),
        expect.stringContaining("Cost unknown"),
      ]);
    });

    it("shows the cost at the preferred basis, per currency, with coverage and the conversion it uses", async () => {
      renderDashboard();
      await screen.findByRole("group", { name: "Cost" });
      expect(tile("Cost")).toHaveTextContent("0.50 AI Credits + $0.70");
      expect(tile("Cost")).toHaveTextContent("3 of 4 turns known");
      expect(tile("Cost")).toHaveTextContent("1 AI Credit = $0.01");
    });

    it("switches the cost figure to one basis for the view", async () => {
      const user = userEvent.setup();
      renderDashboard();
      await screen.findByRole("group", { name: "Cost" });

      await user.click(screen.getByRole("radio", { name: "Billed" }));
      expect(tile("Cost")).toHaveTextContent("0.50 AI Credits");
      expect(tile("Cost")).toHaveTextContent("1 of 4 turns known");

      await user.click(screen.getByRole("radio", { name: "Priced" }));
      expect(tile("Cost")).toHaveTextContent("0.40 AI Credits + $0.75");
    });

    it("filters by cost basis, and a turn with no known cost stays unknown, never 0", async () => {
      renderDashboard();
      await screen.findByRole("group", { name: "Cost" });

      fireEvent.click(option("Cost basis", /Cost unknown/));
      expect(tile("Cost")).toHaveTextContent("—");
      expect(tile("Cost")).toHaveTextContent("0 of 1 turns known");
      expect(screen.getByRole("listitem", { name: "Cost basis: Cost unknown" })).toBeInTheDocument();
    });

    it("selects a basis and switches the view's basis with the keyboard alone", async () => {
      const user = userEvent.setup();
      renderDashboard();
      await screen.findByRole("group", { name: "Cost" });

      option("Cost basis", /Billed/).focus();
      await user.keyboard("{Enter}");
      expect(tile("Sessions")).toHaveTextContent("1");

      screen.getByRole("radio", { name: "Preferred" }).focus();
      await user.keyboard("{ArrowRight}");
      expect(screen.getByRole("radio", { name: "Billed" })).toBeChecked();
    });
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
  // Phase 15 step 15.9 (plan §11.1): the cost tabs share the list boxes'
  // selections; hidden where the product has no cost analyses (the extension).
  describe("cost tabs", () => {
    function renderWithCost(loadSeries = vi.fn().mockResolvedValue(sampleCostSeries())) {
      const loadComparison = vi.fn().mockResolvedValue(sampleCostComparison());
      render(
        <InsightsDashboard
          loadDataset={vi.fn().mockResolvedValue(sampleInsightsDataset())}
          now={NOW}
          costAnalysis
          loadCostSeries={loadSeries}
          loadCostComparison={loadComparison}
        />,
      );
      return { loadSeries, loadComparison };
    }

    it("has no view switch in a product without cost analyses", async () => {
      renderDashboard();
      await screen.findByRole("group", { name: "AI Credits" });
      expect(screen.queryByRole("radiogroup", { name: "Dashboard view" })).not.toBeInTheDocument();
    });

    it("keeps a list-box selection when switching to Cost over time", async () => {
      const { loadSeries } = renderWithCost();
      await screen.findByRole("group", { name: "AI Credits" });
      fireEvent.click(option("Project", /Customer portal/));
      fireEvent.click(within(screen.getByRole("radiogroup", { name: "Dashboard view" })).getByRole("radio", { name: "Cost over time" }));
      expect(await screen.findByRole("group", { name: "Total cost" })).toBeInTheDocument();
      expect(loadSeries).toHaveBeenCalledWith(expect.objectContaining({ groupBy: "project", ids: ["portal"] }), expect.any(AbortSignal));
      expect(screen.getByRole("listitem", { name: "Project: Customer portal" })).toBeInTheDocument();
      expect(screen.queryByRole("group", { name: "AI Credits" })).not.toBeInTheDocument();
    });

    it("opens Compare over the possible projects", async () => {
      const { loadComparison } = renderWithCost();
      await screen.findByRole("group", { name: "AI Credits" });
      fireEvent.click(within(screen.getByRole("radiogroup", { name: "Dashboard view" })).getByRole("radio", { name: "Compare" }));
      expect(await screen.findByText("Compare needs two or more projects.")).toBeInTheDocument();
      expect(loadComparison).not.toHaveBeenCalled();
    });

    // Step 15.10 (plan §11.4): the Project tab, inside the selected project.
    it("opens the Project tab inside the selected project", async () => {
      const loadProjectCost = vi.fn().mockResolvedValue(sampleProjectCost());
      const loadVariance = vi.fn().mockResolvedValue(sampleCostVariance());
      render(
        <InsightsDashboard
          loadDataset={vi.fn().mockResolvedValue(sampleInsightsDataset())}
          now={NOW}
          costAnalysis
          loadCostSeries={vi.fn().mockResolvedValue(sampleCostSeries())}
          loadCostComparison={vi.fn().mockResolvedValue(sampleCostComparison())}
          loadProjectCost={loadProjectCost}
          loadCostVariance={loadVariance}
        />,
      );
      await screen.findByRole("group", { name: "AI Credits" });
      fireEvent.click(option("Project", /Customer portal/));
      fireEvent.click(within(screen.getByRole("radiogroup", { name: "Dashboard view" })).getByRole("radio", { name: "Project" }));
      expect(await screen.findByRole("group", { name: /Cost by vendor/ })).toBeInTheDocument();
      expect(loadProjectCost).toHaveBeenCalledWith(expect.objectContaining({ projectId: "portal" }), expect.any(AbortSignal));
      expect(screen.getByRole("region", { name: "Reconciliation" })).toBeInTheDocument();
    });

    // Step 15.11 (plan §11.5): Billing, and the Projects editor it opens.
    it("opens Billing, and from its empty state the Projects editor, then goes back", async () => {
      const user = userEvent.setup();
      const loadDataset = vi.fn().mockResolvedValue({ ...sampleInsightsDataset(), projects: [] });
      render(
        <InsightsDashboard
          loadDataset={loadDataset}
          now={NOW}
          costAnalysis
          loadCostSeries={vi.fn().mockResolvedValue(sampleCostSeries())}
          billing={{
            loadStatement: vi.fn(),
            loadProjects: vi.fn().mockResolvedValue({ status: "missing", file: { version: 1, projects: [], aliases: {}, captureRules: [] }, problems: [], location: "/x/projects.json" }),
            loadRepositories: vi.fn().mockResolvedValue({ repositories: [], unattributed: [], providers: [] }),
          }}
        />,
      );
      await screen.findByRole("group", { name: "AI Credits" });
      fireEvent.click(within(screen.getByRole("radiogroup", { name: "Dashboard view" })).getByRole("radio", { name: "Billing" }));
      await user.click(await screen.findByRole("button", { name: "Create project" }));
      expect(await screen.findByRole("heading", { name: "Projects" })).toBeInTheDocument();
      expect(screen.queryByRole("group", { name: "AI Credits" })).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /Back to the Dashboard/ }));
      await screen.findByRole("group", { name: "AI Credits" });
      // The dataset is read again: the projects may have changed.
      expect(loadDataset).toHaveBeenCalledTimes(2);
    });

    // Step 15.14 (plan §11.9, board 7): the extension has no projects file or
    // billing (D7, D19), so Project and Billing are left out and the switch
    // says where they are.
    it("leaves out Project and Billing without projects and billing, and says where they are", async () => {
      render(
        <InsightsDashboard
          loadDataset={vi.fn().mockResolvedValue(sampleInsightsDataset())}
          now={NOW}
          costAnalysis
          projectsAndBilling={false}
          loadCostSeries={vi.fn().mockResolvedValue(sampleCostSeries())}
          loadCostComparison={vi.fn().mockResolvedValue(sampleCostComparison())}
        />,
      );
      await screen.findByRole("group", { name: "AI Credits" });
      const views = within(screen.getByRole("radiogroup", { name: "Dashboard view" })).getAllByRole("radio");
      expect(views.map((view) => view.getAttribute("aria-label") ?? view.closest("label")?.textContent)).toEqual(["Overview", "Cost over time", "Compare"]);
      expect(screen.getByText("Billing and estimates: in the Agent Cost Analyzer app")).toBeInTheDocument();
    });

    it("has every view and no note in the standalone app", async () => {
      renderWithCost();
      await screen.findByRole("group", { name: "AI Credits" });
      expect(within(screen.getByRole("radiogroup", { name: "Dashboard view" })).getAllByRole("radio")).toHaveLength(5);
      expect(screen.queryByText("Billing and estimates: in the Agent Cost Analyzer app")).not.toBeInTheDocument();
    });

    it("below 700 px offers the views as a select", async () => {
      vi.stubGlobal(
        "ResizeObserver",
        class {
          constructor(private readonly callback: ResizeObserverCallback) {}
          observe(target: Element) {
            this.callback([{ target, contentRect: { width: 600 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
          }
          unobserve() {}
          disconnect() {}
        },
      );
      renderWithCost();
      await screen.findByRole("group", { name: "AI Credits" });
      const select = screen.getByRole("combobox", { name: "Dashboard view" });
      fireEvent.change(select, { target: { value: "cost-over-time" } });
      expect(await screen.findByRole("group", { name: "Total cost" })).toBeInTheDocument();
      vi.unstubAllGlobals();
    });
  });
});
