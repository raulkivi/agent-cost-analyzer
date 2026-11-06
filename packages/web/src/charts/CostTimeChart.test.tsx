import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { formatAmount, formatTick } from "../lib/cost/cost-format.js";
import { SeriesPalette } from "../lib/cost/series-colors.js";
import { chartLines, groupPriceMarkers } from "../lib/cost/series-model.js";
import { PRICE_MARKER, sampleCostSeries } from "../test-support/cost-fixture.js";
import { CostTimeChart, labelPositions } from "./CostTimeChart.js";

const palette = new SeriesPalette(["portal", "billing", "tools"]);
const series = sampleCostSeries();
const lines = chartLines(series, { palette, unit: "AI_CREDITS" });
const markers = groupPriceMarkers([PRICE_MARKER, { ...PRICE_MARKER, channel: "anthropic-api", toVersionId: "anthropic-api:claude-sonnet-5.5:2026-10-07" }]);
const format = (value: number) => formatAmount(value, "AI_CREDITS");
const tick = (value: number) => formatTick(value, "AI_CREDITS");

function renderChart(props: Partial<Parameters<typeof CostTimeChart>[0]> = {}) {
  return render(
    <CostTimeChart ariaLabel="Cost over time by project" lines={lines} bucket="week" format={format} formatTick={tick} unitLabel="AI Credits" markers={markers} {...props} />,
  );
}

describe("CostTimeChart (plan §11.2)", () => {
  it("draws two to four series as lines with a legend and a direct label at each line's end", () => {
    const { container } = renderChart();
    expect(within(screen.getByRole("list", { name: "Legend" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Customer portal",
      "Billing service",
      "Internal tools",
    ]);
    expect(container.querySelectorAll("[data-direct-label]")).toHaveLength(3);
    expect(container.querySelectorAll("[data-line='tools'] path")).toHaveLength(2);
  });

  it("leaves a bucket with no known cost as a gap with a visible unknown band, never a 0", () => {
    const { container } = renderChart();
    const gaps = container.querySelectorAll("[data-gap]");
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.getAttribute("data-gap")).toBe("2026-W39");
    expect(within(gaps[0] as HTMLElement).getByText("unknown")).toBeInTheDocument();
  });

  it("shows the same figures as a table, with the gap as unknown and the price change in a row of its own", () => {
    renderChart();
    fireEvent.click(screen.getByRole("button", { name: "View as table" }));
    const table = screen.getByRole("table", { name: "Cost over time by project" });
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Week",
      "Customer portal (AI Credits)",
      "Billing service (AI Credits)",
      "Internal tools (AI Credits)",
      "Coverage",
    ]);
    const gapRow = within(table).getByRole("row", { name: /Week of Sep 21, 2026/ });
    expect(within(gapRow).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["39.00", "23.00", "unknown", "24 of 36 turns known"]);
    const first = within(table).getByRole("row", { name: /Week of Aug 3, 2026/ });
    expect(within(first).getAllByRole("cell")[0]).toHaveTextContent("38.00");
    expect(within(table).getByRole("row", { name: /Price change Oct 7, 2026/ })).toHaveTextContent(/claude-sonnet-5.5.*\$0.20.*\$0.10/);
  });

  it("reads each bucket by keyboard: arrows move a crosshair whose tooltip lists every series, Escape hides it", () => {
    renderChart();
    const plot = screen.getByRole("group", { name: /Cost over time by project/ });
    fireEvent.focus(plot);
    fireEvent.keyDown(plot, { key: "ArrowRight" });
    let tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Week of Aug 10, 2026");
    expect(tooltip).toHaveTextContent("Customer portal42.00");
    fireEvent.keyDown(plot, { key: "End" });
    expect(screen.getByRole("tooltip")).toHaveTextContent("Week of Nov 2, 2026");
    fireEvent.keyDown(plot, { key: "Home" });
    for (let index = 0; index < 7; index += 1) fireEvent.keyDown(plot, { key: "ArrowRight" });
    tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Internal toolsunknown");
    expect(tooltip).toHaveTextContent("0 of 12 turns known");
    fireEvent.keyDown(plot, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("puts each price change in the tab order, with old and new unit prices and the source on focus; Escape closes it", () => {
    renderChart();
    // The name is the visible tag (WCAG 2.5.3 label in name); the
    // description says the whole change, before and after.
    const marker = screen.getByRole("button", { name: "Price · claude-sonnet-5.5 −50%" });
    expect(marker).toHaveAccessibleDescription(/^Price change on Oct 7, 2026: claude-sonnet-5.5 .*cached input \$0.20 to \$0.10 per million tokens/);
    fireEvent.focus(marker);
    const tooltip = screen.getByRole("tooltip");
    expect(marker.getAttribute("aria-describedby")).toContain(tooltip.id);
    expect(within(tooltip).getAllByRole("row").map((row) => row.textContent)).toContain("Cached input$0.20$0.10−50%");
    expect(tooltip).toHaveTextContent("GitHub Copilot");
    expect(tooltip).toHaveTextContent("Anthropic API");
    expect(tooltip).toHaveTextContent("Sources: gh-pricing-table");
    expect(tooltip).toHaveTextContent("github-copilot:claude-sonnet-5.5:2026-10-07");
    fireEvent.keyDown(marker, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(marker.getAttribute("aria-describedby")?.split(" ")).not.toContain(tooltip.id);
  });

  it("draws a documented change as a solid hairline", () => {
    const { container } = renderChart();
    const line = container.querySelector("[data-marker='2026-10-07']");
    expect(line?.getAttribute("stroke-dasharray")).toBeNull();
  });

  it("draws one series as columns with a hatched cap on a partly covered bucket", () => {
    const tools = lines.filter((line) => line.key === "tools");
    const { container } = renderChart({ lines: tools, mode: "columns" });
    expect(container.querySelectorAll("[data-column]").length).toBeGreaterThan(10);
    expect(container.querySelectorAll("[data-partial-cap]")).toHaveLength(1);
    expect(screen.queryByRole("list", { name: "Legend" })).not.toBeInTheDocument();
  });

  it("says so when there is nothing to draw", () => {
    renderChart({ lines: [] , emptyText: "No cost in this range." });
    expect(screen.getByText("No cost in this range.")).toBeInTheDocument();
  });
  it("spreads direct labels that end at the same height, inside the plot", () => {
    const placed = labelPositions([200, 200, 200], 10, 200, 32);
    expect([...placed].sort((a, b) => a - b)).toEqual([136, 168, 200]);
    expect(labelPositions([50, 120], 10, 200, 32)).toEqual([50, 120]);
  });
});
