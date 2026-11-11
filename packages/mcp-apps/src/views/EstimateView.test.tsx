// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ViewBrand } from "../brand/view-brand.js";
import type { ToolResult } from "../host/app-host-port.js";
import { FakeAppHostPort } from "../host/fake-app-host-port.js";
import { estimate, refusedEstimate, simulatedEstimate } from "../view-models/increment3-fixtures.js";
import { EstimateView } from "./EstimateView.js";

const brand: ViewBrand = { productId: "standalone", displayName: "Agent Cost Analyzer", version: "0.12.0" };
const extension: ViewBrand = { productId: "vscode-extension", displayName: "AI Credits Analyzer", version: "0.8.0" };
const ok = (structuredContent: unknown): ToolResult => ({ structuredContent });

function setup(result: ToolResult | "waiting" = ok(estimate()), viewBrand: ViewBrand = brand) {
  const port = new FakeAppHostPort();
  return { port, ...render(<EstimateView port={port} brand={viewBrand} result={result === "waiting" ? undefined : result} />) };
}

describe("U15 EstimateView, a range", () => {
  it("is titled for the target and tagged estimate", () => {
    setup();
    expect(screen.getByRole("heading", { level: 1, name: "Estimate for Customer portal" })).toBeInTheDocument();
    expect(screen.getByText("Agent Cost Analyzer · Estimate")).toBeInTheDocument();
    expect(screen.getByText("estimate")).toHaveClass("est-tag");
    expect(screen.queryByText("Simulated")).not.toBeInTheDocument();
    expect(screen.getByText(/10 active days planned · last 12 weeks \(.*\) · today's prices/)).toBeInTheDocument();
  });

  it("draws the p50 to p90 range bar with both ends labelled", () => {
    setup();
    const bar = screen.getByRole("img", { name: "Estimated range $95.00 to $210.00 USD, p50 to p90" });
    expect(within(bar).getByText("p50")).toBeInTheDocument();
    expect(within(bar).getByText("p90")).toBeInTheDocument();
    expect(within(bar).getByText("$95.00")).toBeInTheDocument();
    expect(within(bar).getByText("$210.00")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "About $95.00 to $210.00 USD" })).toBeInTheDocument();
  });

  it("shows the per-unit range and the sample", () => {
    setup();
    const unit = within(screen.getByRole("group", { name: "Cost per active day" }));
    expect(unit.getByText("$9.50 – $21.00")).toBeInTheDocument();
    const sample = within(screen.getByRole("group", { name: "History used" }));
    expect(sample.getByText("24 active days")).toBeInTheDocument();
    expect(sample.getByText(/20 with every turn priced · 800 turns/)).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Planned" })).getByText("10 active days")).toBeInTheDocument();
  });

  // §9.2 Q15: a single run-rate number would read as an estimate.
  it("shows no run rate and no single-number cost", () => {
    const { container } = setup();
    expect(container).not.toHaveTextContent(/12\.90|25\.87|run rate|per week|310\.40/i);
  });

  it("has no control and no Simulated block for the project's own model", () => {
    setup();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Simulated" })).not.toBeInTheDocument();
  });
});

describe("U15 EstimateView on another model", () => {
  it("carries estimate and Simulated, with replay coverage and the self-check count", () => {
    setup(ok(simulatedEstimate()));
    expect(screen.getByRole("heading", { level: 1, name: "Estimate on claude-sonnet-5.5" })).toBeInTheDocument();
    expect(screen.getByText("estimate")).toBeInTheDocument();
    expect(screen.getByText("Simulated")).toBeInTheDocument();
    const block = within(screen.getByRole("region", { name: "Simulated" }));
    expect(block.getByText(/20 of 24 sessions replayed; 700 of 800 turns replayed\./)).toBeInTheDocument();
    expect(block.getByText(/100 turns not replayed:/)).toBeInTheDocument();
    expect(block.getByText(/Self-check: self-check passed for 17 of 18 replayed sessions checked\./)).toBeInTheDocument();
    expect(block.getByText("1 failed, so the range may be off.", { exact: false })).toBeInTheDocument();
    expect(block.getByText(/Assumes: Same conversation\./)).toBeInTheDocument();
  });

  it("does not warn when every self-check passed", () => {
    const sim = simulatedEstimate();
    setup(ok({ ...sim, simulation: { ...sim.simulation, selfCheck: { checked: 6, passed: 6 } } }));
    expect(screen.queryByText(/failed/)).not.toBeInTheDocument();
  });
});

describe("U15 EstimateView, a refusal", () => {
  it("gives the reason, draws no bar, and reads every figure as Unknown, never 0", () => {
    const { container } = setup(ok(refusedEstimate()));
    expect(screen.getByRole("status")).toHaveTextContent("Not enough history to give an estimate. Only 2 days have every turn priced; at least 5 are needed. No range is shown rather than a guess.");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Estimate" })).getByText("Unknown")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: /^Cost per/ })).getByText("Unknown")).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/\$0\.00|0\.00 AI Credits|1\.67/);
  });
});

describe("U15 EstimateView, states and the extension", () => {
  it("waits, and shows an error as text", () => {
    const first = setup("waiting");
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for the estimate");
    first.unmount();
    setup({ isError: true, errorText: "Unknown project id nope" });
    expect(screen.getByRole("alert")).toHaveTextContent("The tool returned an error: Unknown project id nope");
  });

  // A32: capped at 500 characters, as the other views' error text is.
  it("caps a long error text", () => {
    setup({ isError: true, errorText: `Unknown project id nope ${"x".repeat(900)}` });
    expect(screen.getByRole("alert").textContent!.length).toBeLessThan(600);
  });

  it("shows nothing billing-related in the extension, even with a result", () => {
    const { container } = setup(ok(simulatedEstimate()), extension);
    expect(screen.getByRole("heading", { level: 1, name: "No view for this result" })).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/estimate|simulated|\$|USD|Customer portal|p50|p90/i);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
