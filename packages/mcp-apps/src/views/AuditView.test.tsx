// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ViewBrand } from "../brand/view-brand.js";
import type { ToolResult } from "../host/app-host-port.js";
import { FakeAppHostPort } from "../host/fake-app-host-port.js";
import { auditRollup, sessionAudit } from "../view-models/audit-fixtures.js";
import { AuditView } from "./AuditView.js";

const brand: ViewBrand = { productId: "vscode-extension", displayName: "AI Credits Analyzer", version: "0.8.0" };
const ok = (structuredContent: unknown): ToolResult => ({ structuredContent });
const none = { toolCalls: 0, succeeded: 0, failed: 0, interrupted: 0, denied: 0, unknown: 0 };

function setup(result: ToolResult | undefined) {
  const port = new FakeAppHostPort();
  const view = render(<AuditView brand={brand} result={result} />);
  return { port, ...view };
}

describe("AuditView for one session", () => {
  it("renders the header, the four tiles and the footer", () => {
    setup(ok(sessionAudit()));
    expect(screen.getByRole("heading", { level: 1, name: "Add retry to export job" })).toBeInTheDocument();
    expect(screen.getByText("AI Credits Analyzer · Tool-call audit")).toBeInTheDocument();
    expect(screen.getByText("session 5b91d0c4 · Nov 9")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Tool calls" })).getByText("118")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Failed" })).getByText("error 11 · interrupted 2 · denied 1")).toBeInTheDocument();
    const rate = screen.getByRole("group", { name: "Failure rate" });
    expect(within(rate).getByText("12.6 %")).toBeInTheDocument();
    expect(within(rate).getByText("of 111 calls with a known outcome")).toBeInTheDocument();
    const unknown = screen.getByRole("group", { name: "Outcome unknown" });
    expect(within(unknown).getByText("7")).toBeInTheDocument();
    expect(within(unknown).getByText("calls: not counted as success or failure")).toBeInTheDocument();
    expect(screen.getByText("Read-only · local logs · v0.8.0")).toBeInTheDocument();
  });

  it("lists the failure categories with their counts as text, not by colour alone", () => {
    setup(ok(sessionAudit()));
    const list = screen.getByRole("list", { name: "14 failed calls by category" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(6);
    expect(items[0]).toHaveTextContent("test-or-build-failure");
    expect(items[0]).toHaveTextContent("5");
    expect(list.querySelectorAll("[data-bar]")).toHaveLength(6);
  });

  it("shows the recovery cost in tokens, not AI Credits, with the caveat", () => {
    setup(ok(sessionAudit()));
    const section = screen.getByRole("region", { name: "Recovery cost" });
    expect(within(section).getByText("tokens, not AI Credits")).toBeInTheDocument();
    expect(within(section).getByText("6,240 out · 1,284,500 in")).toBeInTheDocument();
    expect(within(section).getByText("turns 4, 7, 12, 13, 19, 22, 27, 31, 38")).toBeInTheDocument();
    expect(within(section).getByText(/Per-round tokens are not recorded/)).toBeInTheDocument();
    expect(section.textContent).not.toMatch(/\d\s*AI Credits/);
  });

  it("lists retried commands as written and the by-tool table", () => {
    setup(ok(sessionAudit()));
    const retries = screen.getByRole("table", { name: "Commands that were retried" });
    expect(within(retries).getByText("npm test -- exporter")).toBeInTheDocument();
    expect(within(retries).getByText("succeeded on try 4")).toBeInTheDocument();
    expect(within(retries).getByText("never succeeded")).toBeInTheDocument();
    const tools = screen.getByRole("table", { name: "Tool calls by tool" });
    expect(within(tools).getAllByRole("row")).toHaveLength(5);
  });

  it("says Unknown, never 0, when no outcome is known, and keeps the unknown count", () => {
    setup(ok(sessionAudit({ totals: { ...none, toolCalls: 5, unknown: 5 }, failureRate: null, outcomeCoverage: { known: 0, unknown: 5, unknownReasons: [] }, byFailureCategory: [], failureRecoveryCost: { recoveryRounds: 0, affectedTurns: [], affectedTurnsOutputTokens: { known: true, value: 0 }, affectedTurnsInputTokens: { known: true, value: 0 } } })));
    expect(within(screen.getByRole("group", { name: "Failure rate" })).getByText("Unknown")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Failed" })).getByText("Unknown")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Outcome unknown" })).getByText("5")).toBeInTheDocument();
    expect(screen.getByText("No call has a known outcome, so no recovery cost is counted.")).toBeInTheDocument();
    expect(screen.getByText("No call has a known outcome, so no failure is counted.")).toBeInTheDocument();
  });

  it("explains a session whose provider records no tool calls, and shows no tables", () => {
    setup(ok(sessionAudit({ toolCallsUnavailableReason: "Agent Host does not record tool calls", totals: none, failureRate: null, byTool: [], byFailureCategory: [], retries: [], perTurn: [], outcomeCoverage: { known: 0, unknown: 0, unknownReasons: [] } })));
    expect(screen.getByRole("status")).toHaveTextContent("Agent Host does not record tool calls");
    expect(within(screen.getByRole("group", { name: "Tool calls" })).getByText("Unknown")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("AuditView for a date range", () => {
  it("renders the period, the tiles, and what was left out", () => {
    setup(ok(auditRollup()));
    expect(screen.getByRole("heading", { level: 1, name: "Tool-call failures" })).toBeInTheDocument();
    expect(screen.getByText("Oct 19 – Nov 1 · 20 sessions")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Tool calls" })).getByText("2,147")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Failure rate" })).getByText("10.8 %")).toBeInTheDocument();
    const left = screen.getByRole("group", { name: "Left out" });
    expect(within(left).getByText("3 sessions")).toBeInTheDocument();
    expect(within(left).getByText("tool calls not recorded; not counted as 0")).toBeInTheDocument();
  });

  it("draws failed calls per day with a hatched gap for a day with no known outcome", () => {
    setup(ok(auditRollup()));
    const chart = screen.getByRole("img", { name: "Failed calls per day, 3 days; most 18 on Oct 21; 1 day unknown" });
    expect(within(chart).getByText("Oct 19: 9 failed calls")).toBeInTheDocument();
    expect(within(chart).getByText("Oct 20: Unknown")).toBeInTheDocument();
    expect(chart.querySelectorAll("[data-unknown]")).toHaveLength(1);
  });

  // A32: role="img" hides each column's <title>, so the per-day figures need
  // a text form, as U12's chart has: View as table, Unknown written, never 0.
  it("offers the failed calls per day as a table, with Unknown for a day with no known outcome", () => {
    setup(ok(auditRollup()));
    expect(screen.queryByRole("table", { name: "Failed calls per day" })).toBeNull();
    const toggle = screen.getByRole("button", { name: "View as table" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveTextContent("Hide table");
    const table = screen.getByRole("table", { name: "Failed calls per day" });
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)).toContainElement(table);
    const rows = within(table).getAllByRole("row").map((row) => row.textContent);
    expect(rows).toEqual(["DayFailed calls", "Oct 199", "Oct 20Unknown", "Oct 2118"]);
    expect(within(table).getByText("Unknown")).toHaveClass("view-unknown");
    expect(screen.getByRole("region", { name: "Failed calls per day, scrollable" })).toHaveAttribute("tabindex", "0");
    fireEvent.click(toggle);
    expect(screen.queryByRole("table", { name: "Failed calls per day" })).toBeNull();
  });

  it("shows categories, the top failing commands and the sessions as display-only text", () => {
    setup(ok(auditRollup()));
    expect(screen.getByRole("list", { name: "149 failed calls by category" })).toBeInTheDocument();
    const commands = screen.getByRole("table", { name: "Top failing commands" });
    expect(within(commands).getByText("npm test")).toBeInTheDocument();
    expect(within(commands).getByText("41")).toBeInTheDocument();
    const sessions = screen.getByRole("table", { name: "Most failures by session" });
    expect(within(sessions).getByText("Fix flaky invoice test")).toBeInTheDocument();
    // No drill-down (owner answer Q10): the chart's View as table is the only control.
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["View as table"]);
  });

  it("makes no host call: it has nothing to send and nothing to open", () => {
    const { port } = setup(ok(auditRollup()));
    expect(port.calls).toEqual([]);
  });
});

describe("AuditView states", () => {
  it("waits for a result", () => {
    setup(undefined);
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for the tool-call audit");
  });

  it("explains an error or a result it can't read", () => {
    const { unmount } = setup({ isError: true });
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load the tool-call audit.");
    unmount();
    setup(ok({ nothing: true }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  // A32: as every other view, an error says what the tool said, as text, capped.
  it("shows the tool's error text", () => {
    setup({ isError: true, errorText: `Unknown session id "nope". ${"x".repeat(600)}` });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent('The tool returned an error: Unknown session id "nope".');
    expect(alert.textContent!.length).toBeLessThan(600);
  });
});
