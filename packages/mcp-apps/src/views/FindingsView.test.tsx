// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { FindingsQueryResult } from "@agent-cost-analyzer/domain";
import type { ViewBrand } from "../brand/view-brand.js";
import { FakeAppHostPort } from "../host/fake-app-host-port.js";
import type { ToolResult } from "../host/app-host-port.js";
import { enrichedFinding, findingsResult, SAMPLE_FINDINGS } from "./findings/fixtures.js";
import { FindingsView } from "./FindingsView.js";

const brand: ViewBrand = { productId: "vscode-extension", displayName: "AI Credits Analyzer", version: "0.9.0" };

const initial = findingsResult(SAMPLE_FINDINGS, { total: 3 });

function ok(result: FindingsQueryResult): ToolResult {
  return { structuredContent: result };
}

// A port whose callTool waits for the test to answer.
class DeferredPort extends FakeAppHostPort {
  private resolvers: ((result: ToolResult) => void)[] = [];
  override callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    this.calls.push({ method: "callTool", args: [name, args] });
    return new Promise((resolve) => this.resolvers.push(resolve));
  }
  answer(result: ToolResult, index = 0): void {
    this.resolvers[index]?.(result);
  }
}

function listFindingsCalls(port: FakeAppHostPort): Record<string, unknown>[] {
  return port.calls.filter((c) => c.method === "callTool").map((c) => c.args[1] as Record<string, unknown>);
}

function renderView(port: FakeAppHostPort, result: ToolResult | undefined = ok(initial)) {
  return render(<FindingsView brand={brand} port={port} result={result} />);
}

describe("FindingsView rendering", () => {
  it("shows the kicker, summary, severity tiles and findings", () => {
    renderView(new FakeAppHostPort());
    expect(screen.getByRole("heading", { name: "Findings" })).toBeInTheDocument();
    expect(screen.getByText("AI Credits Analyzer · Findings")).toBeInTheDocument();
    expect(screen.getByText("3 findings")).toBeInTheDocument();
    const critical = screen.getByRole("group", { name: "Critical" });
    expect(within(critical).getByText("1")).toBeInTheDocument();
    expect(screen.getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["Critical", "High", "Medium", "Low", "Info"]);
    const table = screen.getByRole("table", { name: "Findings" });
    expect(within(table).getByText("Read a credentials file")).toBeInTheDocument();
    expect(within(table).getByText("Rotate deploy keys")).toBeInTheDocument();
    expect(within(table).getByText(/turn 8/)).toBeInTheDocument();
    expect(within(table).getAllByRole("row")).toHaveLength(4);
  });

  it("tags an observed price change as inferred and nothing else", () => {
    renderView(new FakeAppHostPort());
    expect(screen.getAllByText("inferred")).toHaveLength(1);
  });

  it("shows the table's scroll container, bounded in height", () => {
    renderView(new FakeAppHostPort());
    const scroller = screen.getByRole("table", { name: "Findings" }).parentElement!;
    expect(scroller).toHaveClass("findings-scroll");
  });

  it("says how many are shown when the server truncated the list", () => {
    renderView(new FakeAppHostPort(), ok(findingsResult(SAMPLE_FINDINGS, { total: 27 })));
    expect(screen.getByText(/Showing 3 of 27, most severe first/)).toBeInTheDocument();
  });

  it("shows the empty state, with the filters still usable", () => {
    renderView(new FakeAppHostPort(), ok(findingsResult([], { total: 0, bySeverity: { info: 0, low: 0, medium: 0, high: 0, critical: 0 } })));
    expect(screen.getByText("No findings match these filters.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Severity" })).toBeInTheDocument();
  });

  it("shows a whole-view error when the tool returned an error", () => {
    renderView(new FakeAppHostPort(), { isError: true });
    expect(screen.getByRole("alert")).toHaveTextContent("The tool returned an error.");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Findings" })).toBeInTheDocument();
  });

  it("shows the same error for a result it cannot read", () => {
    renderView(new FakeAppHostPort(), { structuredContent: { nope: true } });
    expect(screen.getByRole("alert")).toHaveTextContent("The tool returned an error.");
  });

  it("waits with a status while no result has arrived", () => {
    render(<FindingsView brand={brand} port={new FakeAppHostPort()} result={undefined} />);
    expect(screen.getByRole("heading", { name: "Findings" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading findings");
  });

  it("renders a result that arrives after the first render", () => {
    const port = new FakeAppHostPort();
    const { rerender } = render(<FindingsView brand={brand} port={port} result={undefined} />);
    rerender(<FindingsView brand={brand} port={port} result={ok(initial)} />);
    expect(screen.getByText("3 findings")).toBeInTheDocument();
  });
});

describe("FindingsView evidence", () => {
  it("keeps detail and evidence collapsed by default", () => {
    renderView(new FakeAppHostPort());
    expect(screen.queryByText(/REDACTED/)).not.toBeInTheDocument();
    expect(screen.queryByText(/deploy config directory/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Redacted evidence/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("expands one row's evidence as text and collapses it again", () => {
    renderView(new FakeAppHostPort());
    const toggle = screen.getByRole("button", { name: /Redacted evidence/ });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/\[REDACTED:path\]/)).toBeInTheDocument();
    expect(screen.getByText(/deploy config directory/)).toBeInTheDocument();
    expect(screen.getByText(/never sent to the chat/)).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByText(/REDACTED/)).not.toBeInTheDocument();
  });

  it("renders evidence as inert text, not markup", () => {
    const hostile = enrichedFinding({ evidence: '<img src=x onerror="alert(1)">' });
    const { container } = renderView(new FakeAppHostPort(), ok(findingsResult([hostile])));
    fireEvent.click(screen.getByRole("button", { name: /Redacted evidence/ }));
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeInTheDocument();
  });

  it("offers the reason alone for a finding with no evidence", () => {
    renderView(new FakeAppHostPort(), ok(findingsResult([SAMPLE_FINDINGS[1]!])));
    const toggle = screen.getByRole("button", { name: /Why flagged/ });
    fireEvent.click(toggle);
    expect(screen.getByText(/far more than the median turn/)).toBeInTheDocument();
    expect(screen.queryByText(/never sent to the chat/)).not.toBeInTheDocument();
  });
});

describe("FindingsView filters", () => {
  it("offers the kind and severity filters, with nothing selected", () => {
    renderView(new FakeAppHostPort());
    expect(screen.getByRole("radio", { name: "All" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Security" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Behaviour change" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Price change" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Severity" })).toHaveValue("all");
  });

  it("calls list_findings with the kind when a kind is picked, then renders the new result", async () => {
    const port = new FakeAppHostPort();
    const filtered = findingsResult([SAMPLE_FINDINGS[0]!], { total: 1 });
    port.toolResults.set("list_findings", ok(filtered));
    renderView(port);
    fireEvent.click(screen.getByRole("radio", { name: "Security" }));
    await waitFor(() => expect(screen.getByText("1 finding")).toBeInTheDocument());
    expect(listFindingsCalls(port)).toEqual([{ kind: ["security"] }]);
    expect(port.calls.find((c) => c.method === "callTool")!.args[0]).toBe("list_findings");
    expect(screen.getByRole("radio", { name: "Security" })).toBeChecked();
    expect(screen.getAllByRole("row")).toHaveLength(2);
  });

  it("calls list_findings with minSeverity when a severity is picked", async () => {
    const port = new FakeAppHostPort();
    port.toolResults.set("list_findings", ok(findingsResult([SAMPLE_FINDINGS[0]!], { total: 1 })));
    renderView(port);
    fireEvent.change(screen.getByRole("combobox", { name: "Severity" }), { target: { value: "high" } });
    await waitFor(() => expect(screen.getByText("1 finding")).toBeInTheDocument());
    expect(listFindingsCalls(port)).toEqual([{ minSeverity: "high" }]);
  });

  it("combines both filters in the next call and drops them when reset", async () => {
    const port = new FakeAppHostPort();
    port.toolResults.set("list_findings", ok(initial));
    renderView(port);
    fireEvent.click(screen.getByRole("radio", { name: "Security" }));
    await waitFor(() => expect(listFindingsCalls(port)).toHaveLength(1));
    fireEvent.change(screen.getByRole("combobox", { name: "Severity" }), { target: { value: "high" } });
    await waitFor(() => expect(listFindingsCalls(port)).toHaveLength(2));
    fireEvent.click(screen.getByRole("radio", { name: "All" }));
    await waitFor(() => expect(listFindingsCalls(port)).toHaveLength(3));
    fireEvent.change(screen.getByRole("combobox", { name: "Severity" }), { target: { value: "all" } });
    await waitFor(() => expect(listFindingsCalls(port)).toHaveLength(4));
    expect(listFindingsCalls(port)).toEqual([{ kind: ["security"] }, { kind: ["security"], minSeverity: "high" }, { minSeverity: "high" }, {}]);
  });

  it("keeps the window and provider the model asked for", async () => {
    const port = new FakeAppHostPort();
    port.toolResults.set("list_findings", ok(initial));
    port.pushToolInput({ since: "2026-10-01", provider: "copilot", kind: ["anomaly"], minSeverity: "low" });
    renderView(port);
    expect(screen.getByRole("radio", { name: "Anomaly" })).toBeChecked();
    expect(screen.getByRole("combobox", { name: "Severity" })).toHaveValue("low");
    fireEvent.click(screen.getByRole("radio", { name: "Security" }));
    await waitFor(() => expect(listFindingsCalls(port)).toHaveLength(1));
    expect(listFindingsCalls(port)[0]).toEqual({ since: "2026-10-01", provider: "copilot", kind: ["security"], minSeverity: "low" });
  });

  it("dims the tiles below the minimum severity", async () => {
    const port = new FakeAppHostPort();
    port.toolResults.set("list_findings", ok(initial));
    renderView(port);
    fireEvent.change(screen.getByRole("combobox", { name: "Severity" }), { target: { value: "high" } });
    await waitFor(() => expect(screen.getByRole("group", { name: "Medium" })).toHaveClass("is-dim"));
    expect(screen.getByRole("group", { name: "High" })).not.toHaveClass("is-dim");
  });
});

describe("FindingsView loading and errors on refetch", () => {
  it("keeps the previous result visible and shows a status while the call is in flight", async () => {
    const port = new DeferredPort();
    renderView(port);
    fireEvent.click(screen.getByRole("radio", { name: "Security" }));
    expect(screen.getByRole("status")).toHaveTextContent("Loading findings");
    expect(screen.getByText("Read a credentials file")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Findings" })).toHaveAttribute("aria-busy", "true");
    await act(async () => port.answer(ok(findingsResult([SAMPLE_FINDINGS[1]!], { total: 1 }))));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText("Read a credentials file")).not.toBeInTheDocument();
    expect(screen.getByText("Turn cost 6.2 x the session median")).toBeInTheDocument();
  });

  it("keeps the previous result and offers a retry when the call fails", async () => {
    const port = new FakeAppHostPort();
    renderView(port);
    fireEvent.click(screen.getByRole("radio", { name: "Security" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load the findings");
    expect(screen.getByText("Read a credentials file")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "All" })).toBeChecked();

    port.toolResults.set("list_findings", ok(findingsResult([SAMPLE_FINDINGS[0]!], { total: 1 })));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(listFindingsCalls(port)).toEqual([{ kind: ["security"] }, { kind: ["security"] }]);
    expect(screen.getByRole("radio", { name: "Security" })).toBeChecked();
  });

  it("treats a rejected call like a failed one", async () => {
    const port = new FakeAppHostPort();
    port.callTool = () => Promise.reject(new Error("host went away"));
    renderView(port);
    fireEvent.click(screen.getByRole("radio", { name: "Security" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the findings");
    expect(screen.getByText("Read a credentials file")).toBeInTheDocument();
  });

  it("ignores an answer that arrives after a newer request", async () => {
    const port = new DeferredPort();
    renderView(port);
    fireEvent.click(screen.getByRole("radio", { name: "Security" }));
    fireEvent.click(screen.getByRole("radio", { name: "Anomaly" }));
    await act(async () => port.answer(ok(findingsResult([SAMPLE_FINDINGS[1]!], { total: 1 })), 1));
    await act(async () => port.answer(ok(findingsResult([SAMPLE_FINDINGS[0]!], { total: 1 })), 0));
    expect(screen.getByText("Turn cost 6.2 x the session median")).toBeInTheDocument();
    expect(screen.queryByText("Read a credentials file")).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Anomaly" })).toBeChecked();
  });
});

describe("FindingsView never forwards finding text (plan section 6)", () => {
  it("makes no sendMessage, updateModelContext or openLink call, and calls tools with filters only", async () => {
    const port = new FakeAppHostPort();
    port.toolResults.set("list_findings", ok(initial));
    renderView(port);
    for (const toggle of screen.getAllByRole("button")) fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("radio", { name: "Security" }));
    await waitFor(() => expect(listFindingsCalls(port)).toHaveLength(1));
    fireEvent.change(screen.getByRole("combobox", { name: "Severity" }), { target: { value: "medium" } });
    await waitFor(() => expect(listFindingsCalls(port)).toHaveLength(2));

    const forbidden = ["sendMessage", "updateModelContext", "openLink"];
    expect(port.calls.filter((c) => forbidden.includes(c.method))).toEqual([]);
    const sentText = JSON.stringify(listFindingsCalls(port));
    for (const finding of SAMPLE_FINDINGS) {
      expect(sentText).not.toContain(finding.title);
      expect(sentText).not.toContain(finding.why);
      expect(sentText).not.toContain(finding.sessionTitle);
      if (finding.evidence) expect(sentText).not.toContain(finding.evidence);
    }
  });
});
