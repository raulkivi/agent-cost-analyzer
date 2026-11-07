// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CostSeries } from "@agent-cost-analyzer/domain";
import type { CostSeriesQuery } from "../../api-client/cost-analysis.js";
import { COST_FIXTURE_NOW, MORE_PROJECTS, sampleCostSeries, THREE_PROJECTS } from "../../test-support/cost-fixture.js";
import { CostOverTimeTab } from "./CostOverTimeTab.js";

const ORDERS = { project: ["portal", "billing", "tools", "data", "mobile"], repository: [] as string[] };
const PLACEHOLDERS = { project: "(no-project)", repository: "(unattributed)" };

function loader(series: CostSeries = sampleCostSeries()) {
  return vi.fn((query: CostSeriesQuery) =>
    Promise.resolve(query.bucket === "day" ? sampleCostSeries(THREE_PROJECTS, { bucket: "day", range: { since: query.since!, until: query.until! } }) : series),
  );
}

function renderTab(props: Partial<Parameters<typeof CostOverTimeTab>[0]> = {}) {
  const loadSeries = (props.loadSeries ?? loader()) as ReturnType<typeof loader>;
  render(
    <CostOverTimeTab
      selections={{ project: ["portal", "billing", "tools"] }}
      fieldLabel={(field) => field[0]!.toUpperCase() + field.slice(1)}
      orders={ORDERS}
      placeholders={PLACEHOLDERS}
      basis="preferred"
      now={COST_FIXTURE_NOW}
      loadSeries={loadSeries}
      {...props}
    />,
  );
  return { loadSeries };
}

describe("CostOverTimeTab (plan §11.2, board 1)", () => {
  it("asks for the selected projects over the last 90 days by week, plus the previous period day by day for the KPIs", async () => {
    const { loadSeries } = renderTab();
    await screen.findByRole("group", { name: "Total cost" });
    expect(loadSeries).toHaveBeenCalledWith(
      { since: "2026-08-09", until: "2026-11-06", bucket: "week", basis: "preferred", pricing: "as-of-use", groupBy: "project", ids: ["portal", "billing", "tools"] },
      expect.any(AbortSignal),
    );
    expect(loadSeries).toHaveBeenCalledWith(
      { since: "2026-05-11", until: "2026-11-06", bucket: "day", basis: "preferred", pricing: "as-of-use", groupBy: "project", ids: ["portal", "billing", "tools"] },
      expect.any(AbortSignal),
    );
  });

  it("shows the total with its coverage, never as complete when some cost is unknown", async () => {
    renderTab();
    const total = await screen.findByRole("group", { name: "Total cost" });
    expect(total).toHaveTextContent("1,134.00 AI Credits");
    expect(total).toHaveTextContent("454 of 468 turns known");
    expect(screen.getByRole("group", { name: "Coverage" })).toHaveTextContent("97%");
    expect(screen.getByRole("group", { name: "Change vs previous period" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Cost per active day" })).toBeInTheDocument();
    expect(screen.getByText(/some turns have no known cost/i)).toBeInTheDocument();
  });

  it("draws two to four series as lines, with the weekly kicker, and the gap as unknown in the table", async () => {
    renderTab();
    await screen.findByRole("group", { name: "Total cost" });
    expect(screen.getByText(/Cost over time · weekly · AI Credits · as of use/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "3 projects" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View as table" }));
    const row = within(screen.getByRole("table", { name: /Cost over time/ })).getByRole("row", { name: /Week of Sep 21, 2026/ });
    expect(row).toHaveTextContent("unknown");
  });

  it("draws one series as columns with a separate running total, never a second axis", async () => {
    const one = sampleCostSeries([THREE_PROJECTS[2]!]);
    renderTab({ selections: { project: ["tools"] }, loadSeries: loader(one) });
    expect(await screen.findByRole("heading", { name: "Internal tools" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /Running total/ })).toBeInTheDocument();
  });

  it("draws five or more series as small multiples with a shared or own scale", async () => {
    renderTab({ selections: {}, loadSeries: loader(sampleCostSeries(MORE_PROJECTS)) });
    expect(await screen.findByRole("heading", { name: "5 projects" })).toBeInTheDocument();
    expect(screen.getAllByRole("region", { name: /^Small multiple:/ })).toHaveLength(5);
    expect(screen.getByRole("radio", { name: "Shared scale" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Own scale" }));
    expect(screen.getByRole("radio", { name: "Own scale" })).toBeChecked();
  });

  it("re-asks with the new bucket and range, and switches currency without asking again", async () => {
    const { loadSeries } = renderTab();
    await screen.findByRole("group", { name: "Total cost" });
    fireEvent.click(screen.getByRole("radio", { name: "Month" }));
    await waitFor(() => expect(loadSeries).toHaveBeenCalledWith(expect.objectContaining({ bucket: "month" }), expect.any(AbortSignal)));
    fireEvent.click(screen.getByRole("radio", { name: "Last month" }));
    await waitFor(() => expect(loadSeries).toHaveBeenCalledWith(expect.objectContaining({ since: "2026-10-01", until: "2026-10-31" }), expect.any(AbortSignal)));
    await screen.findByRole("group", { name: "Total cost" });
    const calls = loadSeries.mock.calls.length;
    fireEvent.click(screen.getByRole("radio", { name: "USD" }));
    expect(await screen.findByRole("group", { name: "Total cost" })).toHaveTextContent("$11.34");
    expect(loadSeries.mock.calls.length).toBe(calls);
    fireEvent.click(screen.getByRole("radio", { name: "Today's prices" }));
    await waitFor(() => expect(loadSeries).toHaveBeenCalledWith(expect.objectContaining({ pricing: "today" }), expect.any(AbortSignal)));
  });

  it("states the conversion when a figure in the other currency was converted", async () => {
    renderTab();
    await screen.findByRole("group", { name: "Total cost" });
    expect(screen.getByText(/USD figures converted at 1 AI Credit = \$0.01/)).toBeInTheDocument();
  });

  it("names the selections the cost figures can't follow", async () => {
    renderTab({ selections: { project: ["portal"], model: ["gpt-6.1-sol"] } });
    expect(await screen.findByText(/Not applied here: Model\./)).toBeInTheDocument();
  });

  it("asks for one provider when exactly one is selected", async () => {
    const { loadSeries } = renderTab({ selections: { provider: ["vscode"] } });
    await screen.findByRole("group", { name: "Total cost" });
    expect(loadSeries).toHaveBeenCalledWith(expect.objectContaining({ provider: "vscode", groupBy: "project" }), expect.any(AbortSignal));
  });

  it("shows what failed with Retry", async () => {
    const loadSeries = vi.fn().mockRejectedValue(new Error("Request to /api/cost/timeseries failed with status 500"));
    renderTab({ loadSeries });
    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not load cost over time/);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("explains an empty range, with a next step", async () => {
    const empty = sampleCostSeries([{ key: "portal", label: "Customer portal", values: [] }]);
    renderTab({ loadSeries: vi.fn().mockResolvedValue(empty) });
    expect(await screen.findByText("No turns in this range for this selection.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show this year" })).toBeInTheDocument();
  });
});
