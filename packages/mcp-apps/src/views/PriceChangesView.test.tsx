// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ViewBrand } from "../brand/view-brand.js";
import type { ToolResult } from "../host/app-host-port.js";
import { FakeAppHostPort } from "../host/fake-app-host-port.js";
import { exerciseEveryControl } from "../test-support/exercise-controls.js";
import { priceChangeList } from "../view-models/increment3-fixtures.js";
import { PriceChangesView } from "./PriceChangesView.js";
import type { PriceChangesFrame } from "./PriceChangesView.js";

const brand: ViewBrand = { productId: "vscode-extension", displayName: "AI Credits Analyzer", version: "0.4.0" };
const ok = (structuredContent: unknown): ToolResult => ({ structuredContent });

function setup(result: ToolResult | "waiting" = ok(priceChangeList()), frame?: PriceChangesFrame, port = new FakeAppHostPort()) {
  return { port, ...render(<PriceChangesView port={port} brand={brand} result={result === "waiting" ? undefined : result} {...(frame === undefined ? {} : { frame })} />) };
}

const entry = (kind: "documented" | "observed") => document.querySelector(`[data-kind="${kind}"]`) as HTMLElement;

describe("PriceChangesView content", () => {
  it("titles the view with the period and counts both kinds", () => {
    setup(ok(priceChangeList({ since: "2026-10-01", until: "2026-10-31" })));
    expect(screen.getByRole("heading", { level: 1, name: "Price changes, Oct 1 – Oct 31" })).toBeInTheDocument();
    expect(screen.getByText("oldest first · 2 changes · 1 documented, 1 inferred")).toBeInTheDocument();
    expect(screen.getByText("AI Credits Analyzer · Price changes")).toBeInTheDocument();
  });

  it("lists the changes oldest first, documented and observed in one list", () => {
    setup();
    const headings = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
    expect(headings[0]).toContain("gpt-5.5");
    expect(headings[1]).toContain("claude-sonnet-5.5");
  });

  it("shows a documented change with % per token type, the sign, and its sources", () => {
    setup();
    const documented = within(entry("documented"));
    expect(documented.getByText("documented")).toBeInTheDocument();
    expect(documented.getByText("+25.00 %")).toBeInTheDocument();
    expect(documented.getByText("−20.00 %")).toBeInTheDocument();
    expect(documented.getByText("$2.00 / 1M → $2.50 / 1M")).toBeInTheDocument();
    expect(documented.getByText(/Source: src-copilot-models\./)).toBeInTheDocument();
    expect(documented.getByText(/Announced in the changelog/)).toBeInTheDocument();
    expect(documented.queryByText("inferred")).not.toBeInTheDocument();
    expect(documented.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows a missing price as 'no earlier price', never 0 and never a rise or a fall", () => {
    setup();
    const line = within(entry("documented")).getByText("cache write").closest(".pc-line") as HTMLElement;
    expect(within(line).getByText("no earlier price")).toBeInTheDocument();
    expect(line).not.toHaveTextContent(/\b0(\.0+)? %/);
    expect(within(line).getByText("none → $3.00 / 1M")).toBeInTheDocument();
    expect(line.querySelector(".pc-rise, .pc-fall")).toBeNull();
  });

  it("colours a rise and a fall differently and writes the sign too, for documented and inferred changes", () => {
    setup();
    const documented = within(entry("documented"));
    expect(documented.getByText("+25.00 %")).toHaveClass("pc-rise");
    expect(documented.getByText("−20.00 %")).toHaveClass("pc-fall");
    // Billed above the price book is a rise even when it is only inferred.
    expect(within(entry("observed")).getByText("+12 %")).toHaveClass("pc-rise");
  });

  it("colours an inferred fall as a fall, with its minus", () => {
    const base = priceChangeList();
    const observed = base.changes.find((change) => change.kind === "observed")!;
    setup(ok(priceChangeList({ changes: [{ ...observed, direction: "below", percent: -0.1 }] })));
    expect(within(entry("observed")).getByText("−10 %")).toHaveClass("pc-fall");
    expect(within(entry("observed")).getByText(/below the price book/)).toBeInTheDocument();
  });

  it("shows an observed change as inferred, with the weekly billed-vs-priced table and the caveat", () => {
    setup();
    const observed = within(entry("observed"));
    expect(observed.getByText("inferred")).toBeInTheDocument();
    expect(observed.queryByText("documented")).not.toBeInTheDocument();
    const table = observed.getByRole("table", { name: "claude-sonnet-5.5 weekly billed against priced" });
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Week", "Turns", "Billed", "Priced", "Ratio"]);
    expect(within(table).getByRole("cell", { name: "2026-W43" })).toBeInTheDocument();
    expect(within(table).getByText("112.00 AI Credits")).toBeInTheDocument();
    expect(within(table).getAllByText("1.12 × the price book")).toHaveLength(2);
    expect(observed.getByText(/inferred from billed vs priced figures, not documented/)).toBeInTheDocument();
    expect(observed.getByText(/Seen in the logs; the vendor has not documented it/)).toBeInTheDocument();
  });

  it("keeps the two kinds apart by shape: solid and dashed rails, solid and dashed hollow diamonds", () => {
    setup();
    expect(entry("documented").querySelector(".pc-rail")).not.toHaveClass("pc-rail-inferred");
    expect(entry("observed").querySelector(".pc-rail")).toHaveClass("pc-rail-inferred");
    expect(entry("observed").querySelector(".pc-mark")).toHaveClass("pc-mark-inferred");
    expect(entry("documented").querySelector(".pc-mark")).not.toHaveClass("pc-mark-inferred");
    const chart = screen.getByRole("img", { name: /documented solid and inferred dashed: 1 documented, 1 inferred/ });
    expect(chart.querySelector('[data-mark="documented"]')).not.toHaveClass("pc-mark-inferred");
    expect(chart.querySelector('[data-mark="observed"]')).toHaveClass("pc-mark-inferred");
    expect(within(screen.getByRole("list", { name: "Timeline key" })).getAllByRole("listitem")).toHaveLength(2);
  });

  it("names providers that were not fully read", () => {
    setup(ok(priceChangeList({ providers: [{ id: "pi", label: "pi", available: false, unavailableReason: "no logs", sessionCount: 0, truncated: false }] })));
    expect(within(screen.getByRole("list", { name: "Providers not fully read" })).getByText("pi: no logs")).toBeInTheDocument();
  });

  it("has no drill-down: the only controls are the weekly tables' scroll regions", async () => {
    const { port } = setup();
    const pressed = await exerciseEveryControl();
    expect(pressed).toEqual([]);
    expect(port.calls).toEqual([]);
  });
});

describe("PriceChangesView states", () => {
  it("says so when no price changed, and what to ask", () => {
    setup(ok(priceChangeList({ changes: [] })));
    expect(screen.getByText("No price changes found in this period")).toBeInTheDocument();
    expect(screen.getByText(/Ask for a wider period/)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("waits for the result", () => {
    setup("waiting");
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for the price changes");
  });

  it("shows a tool error's text as plain text", () => {
    setup({ isError: true, errorText: "<b>since</b>: not a date" });
    expect(screen.getByRole("alert")).toHaveTextContent("The tool returned an error: <b>since</b>: not a date");
    expect(screen.getByRole("alert").querySelector("b + b, span b")).toBeNull();
  });

  it("explains an error without text and an unreadable result", () => {
    const first = setup({ isError: true });
    expect(screen.getByRole("alert")).toHaveTextContent(/returned an error or a result this view can't read/);
    first.unmount();
    setup(ok({ changes: "none" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/can't read/);
  });
});

describe("PriceChangesView filtered by U11", () => {
  const frame = (models: string[]): PriceChangesFrame => ({ kicker: "Cost change › Price changes", lead: <button type="button">Back to cost change</button>, models });

  it("shows the named models only, and says which and how many of the range", () => {
    setup(ok(priceChangeList({ since: "2026-10-01", until: "2026-10-31" })), frame(["claude-sonnet-5.5"]));
    expect(screen.getByRole("heading", { level: 1, name: "Price changes behind the cost change" })).toBeInTheDocument();
    expect(screen.getByText("Showing claude-sonnet-5.5, the model with the largest price effect in the cost change. 1 of 2 changes in the range.")).toBeInTheDocument();
    expect(screen.getByText("Oct 1 – Oct 31 · oldest first · 1 change · 1 inferred")).toBeInTheDocument();
    expect(entry("documented")).toBeNull();
    expect(screen.getByRole("button", { name: "Back to cost change" })).toBeInTheDocument();
  });

  it("is empty, saying why, when none of the changes is for those models", () => {
    setup(ok(priceChangeList()), frame(["other-model"]));
    expect(screen.getByText(/No price changes for other-model in this period; 2 changes in the range are for other models/)).toBeInTheDocument();
    expect(screen.getByText(/Go back to the cost change/)).toBeInTheDocument();
  });
});

describe("PriceChangesView stylesheet", () => {
  const css = readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), "price-changes", "price-changes.css"), "utf8");

  // A32: through the text tokens, which hold the host's colour at 4.5:1.
  it("colours a rise with the host's danger colour and a fall with its success colour", () => {
    expect(css).toMatch(/\.pc-rise \{ color: var\(--view-text-rise\)/);
    expect(css).toMatch(/\.pc-fall \{ color: var\(--view-text-fall\)/);
    const host = readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "theme", "theme-mcp-host.css"), "utf8");
    expect(host).toMatch(/--view-text-rise: color-mix\(in srgb, var\(--color-text-danger, /);
    expect(host).toMatch(/--view-text-fall: color-mix\(in srgb, var\(--color-text-success, /);
  });

  it("uses no colour literals", () => {
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  });

  it("narrows to a single column rail at 360 px", () => {
    expect(css).toMatch(/@media \(max-width: 480px\)/);
  });
});
