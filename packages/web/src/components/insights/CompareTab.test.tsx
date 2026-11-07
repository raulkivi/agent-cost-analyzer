// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { COST_FIXTURE_NOW, sampleCostComparison, sampleCostSeries } from "../../test-support/cost-fixture.js";
import { CompareTab } from "./CompareTab.js";

const ORDERS = { project: ["portal", "billing", "tools"], repository: ["github.com/acme/a", "github.com/acme/b"] };
const PLACEHOLDERS = { project: "(no-project)", repository: "(unattributed)" };

function renderTab(props: Partial<Parameters<typeof CompareTab>[0]> = {}) {
  const loadComparison = props.loadComparison ?? vi.fn().mockResolvedValue(sampleCostComparison());
  const loadSeries = props.loadSeries ?? vi.fn().mockResolvedValue(sampleCostSeries());
  render(
    <CompareTab
      selections={{}}
      possible={{ project: ["portal", "billing", "tools", "(no-project)"], repository: ["github.com/acme/a", "github.com/acme/b"] }}
      fieldLabel={(field) => field[0]!.toUpperCase() + field.slice(1)}
      orders={ORDERS}
      placeholders={PLACEHOLDERS}
      basis="preferred"
      now={COST_FIXTURE_NOW}
      loadComparison={loadComparison}
      loadSeries={loadSeries}
      {...props}
    />,
  );
  return { loadComparison, loadSeries };
}

function cells(row: HTMLElement) {
  return within(row).getAllByRole("cell").map((cell) => cell.textContent);
}

describe("CompareTab (plan §11.3, boards 2a and 2b)", () => {
  it("compares every possible project when fewer than two are selected, in USD with the conversion stated", async () => {
    const { loadComparison, loadSeries } = renderTab();
    await screen.findByRole("table", { name: /Compare/ });
    expect(loadComparison).toHaveBeenCalledWith(
      { since: "2026-08-09", until: "2026-11-06", groupBy: "project", ids: ["portal", "billing", "tools"], basis: "preferred", pricing: "as-of-use", currency: "usd" },
      expect.any(AbortSignal),
    );
    expect(loadSeries).toHaveBeenCalledWith(
      { since: "2026-08-09", until: "2026-11-06", bucket: "week", groupBy: "project", ids: ["portal", "billing", "tools"], basis: "preferred", pricing: "as-of-use" },
      expect.any(AbortSignal),
    );
  });

  it("shows the §8.2 measures per project with units in the headers, unknown as unknown, and a selection total", async () => {
    renderTab();
    const table = await screen.findByRole("table", { name: /Compare/ });
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Project",
      "Total (AI Credits)",
      "Change",
      "Per session (AI Credits)",
      "Per active day (AI Credits)",
      "Share",
      "Cache-hit ratio",
      "Output share",
      "Coverage",
    ]);
    const portal = within(table).getByRole("row", { name: /Customer portal/ });
    expect(cells(portal)).toEqual(["603.00", "+17.8%", "2.82", "10.40", "52.7%", "71.0%", "9.1%", "98%"]);
    const tools = within(table).getByRole("row", { name: /Internal tools/ });
    expect(cells(tools)[1]).toBe("unknown");
    const total = within(table).getByRole("row", { name: /Selection/ });
    expect(cells(total)[0]).toBe("1,144.00");
    expect(screen.getByText(/Internal tools: 84% of turns have a known cost/)).toBeInTheDocument();
  });

  it("compares the selected repositories when grouped by repository", async () => {
    const { loadComparison } = renderTab({ selections: { repository: ["github.com/acme/a", "github.com/acme/b"] } });
    await screen.findByRole("table", { name: /Compare/ });
    fireEvent.click(screen.getByRole("radio", { name: "Repository" }));
    await waitFor(() =>
      expect(loadComparison).toHaveBeenCalledWith(expect.objectContaining({ groupBy: "repository", ids: ["github.com/acme/a", "github.com/acme/b"] }), expect.any(AbortSignal)),
    );
  });

  it("explains when there are fewer than two to compare", async () => {
    renderTab({ possible: { project: ["portal"], repository: [] } });
    expect(await screen.findByText("Compare needs two or more projects.")).toBeInTheDocument();
  });

  it("draws an indexed line chart (first period = 100) and share-of-total bars, each with a table view", async () => {
    renderTab();
    await screen.findByRole("table", { name: /Compare/ });
    expect(screen.getByRole("group", { name: /Indexed cost/ })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Share of total" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Customer portal 52.7%" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "View as table" })).toHaveLength(2);
  });

  describe("below 700 px (board 2b)", () => {
    it("keeps the priority columns, with the rest in each row's details; Escape returns focus to Details", async () => {
      renderTab({ narrow: true });
      const table = await screen.findByRole("table", { name: /Compare/ });
      expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Project", "Total (AI Credits)", "Change", "Coverage", "Details"]);
      const details = within(table).getByRole("button", { name: "Details for Customer portal" });
      details.focus();
      fireEvent.click(details);
      const drawer = screen.getByRole("region", { name: "Customer portal" });
      expect(drawer).toHaveTextContent("Per session (214 sessions)2.82");
      expect(drawer).toHaveTextContent("Per active day (58 days)10.40");
      expect(drawer).toHaveTextContent("Previous period512.00");
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("region", { name: "Customer portal" })).not.toBeInTheDocument();
      expect(details).toHaveFocus();
    });

    it("lets the person keep more columns", async () => {
      renderTab({ narrow: true });
      await screen.findByRole("table", { name: /Compare/ });
      fireEvent.click(screen.getByRole("button", { name: "Columns" }));
      fireEvent.click(screen.getByRole("checkbox", { name: "Share" }));
      expect(within(screen.getByRole("table", { name: /Compare/ })).getAllByRole("columnheader").map((header) => header.textContent)).toContain("Share");
    });
  });
});
