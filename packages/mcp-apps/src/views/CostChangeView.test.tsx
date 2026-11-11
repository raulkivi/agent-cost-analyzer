// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";
import path from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { ViewBrand } from "../brand/view-brand.js";
import type { ToolResult } from "../host/app-host-port.js";
import { FakeAppHostPort } from "../host/fake-app-host-port.js";
import { exerciseEveryControl } from "../test-support/exercise-controls.js";
import { axeViolations } from "../test-support/axe.js";
import { costVariance, varianceCurrency } from "../view-models/cost-analysis-fixtures.js";
import { priceChangeList } from "../view-models/increment3-fixtures.js";
import { CostChangeView } from "./CostChangeView.js";

const brand: ViewBrand = { productId: "vscode-extension", displayName: "AI Credits Analyzer", version: "0.4.0" };
const ok = (structuredContent: unknown): ToolResult => ({ structuredContent });

// usage +50, price -20, mix +10: a rise made of a rise, a fall and a rise.
const mixed = () => costVariance({ currencies: [varianceCurrency({ costA: 100, costB: 140, change: 40, usage: 50, price: -20, mix: 10 })] });

function setup(result: ToolResult | "waiting" | "default" = "default", port = new FakeAppHostPort()) {
  return { port, ...render(<CostChangeView port={port} brand={brand} result={result === "default" ? ok(mixed()) : result === "waiting" ? undefined : result} />) };
}

describe("CostChangeView content", () => {
  // U10's .cc-total is a flex column in the same bundle; a shared name turned this row into a stack of cells.
  it("marks the all-models row with a class U10's stylesheet does not use", () => {
    setup();
    const row = screen.getByText("All models").closest("tr");
    expect(row).toHaveClass("cv-total");
    expect(row).not.toHaveClass("cc-total");
  });

  it("uses none of U10's cc- class names: U11's own prefix is cv-", () => {
    const { container } = setup();
    for (const button of screen.getAllByRole("button", { name: /claude|View as table/ })) fireEvent.click(button);
    const borrowed = [...container.querySelectorAll("[class]")].flatMap((element) => [...element.classList].filter((name) => name.startsWith("cc-")));
    expect(borrowed).toEqual([]);
  });

  it("names the subject, both periods, the basis and the pricing mode", () => {
    setup();
    expect(screen.getByRole("heading", { level: 1, name: "widgets" })).toBeInTheDocument();
    expect(screen.getByText("AI Credits Analyzer · Cost change")).toBeInTheDocument();
    expect(screen.getByText(/2026-09 vs 2026-10 · priced, prices as of use/)).toBeInTheDocument();
    expect(screen.getByText("Read-only · local logs · v0.4.0")).toBeInTheDocument();
  });

  it("shows both periods, the change with its sign and percent, and the not-explained count", () => {
    setup();
    expect(within(screen.getByRole("group", { name: "2026-09 (A)" })).getByText("100.00 AI Credits")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "2026-10 (B)" })).getByText("140.00 AI Credits")).toBeInTheDocument();
    const change = screen.getByRole("group", { name: "Change" });
    expect(within(change).getByText("+40.00 AI Credits")).toBeInTheDocument();
    expect(within(change).getByText("+40.0 %")).toBeInTheDocument();
    const tile = within(screen.getByRole("group", { name: "Not explained" }));
    expect(tile.getByText("3 turns")).toBeInTheDocument();
    expect(tile.getByText("no price for these turns; not counted as 0")).toBeInTheDocument();
  });

  it("draws no Not explained tile when every turn is explained, as the board does", () => {
    setup(ok(costVariance({ ...mixed(), notExplained: { periodA: { turns: 0 }, periodB: { turns: 0 } } })));
    expect(screen.queryByRole("group", { name: "Not explained" })).not.toBeInTheDocument();
    expect(screen.queryByText("0 turns")).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Change" })).toBeInTheDocument();
    // The section below still says every turn has a priced figure.
    expect(within(screen.getByRole("region", { name: "Not explained" })).getByText("every turn has a priced figure")).toBeInTheDocument();
  });

  // A33: the success colour drawn as a mark (--view-mark-fall), which holds 3:1 on VS Code Light Modern.
  it("colours a fall with the host's success colour as a mark, not info", () => {
    const css = readFileSync(path.join(__dirname, "cost-change/cost-change.css"), "utf8");
    const theme = readFileSync(path.join(__dirname, "../theme/theme-mcp-host.css"), "utf8");
    expect(css).toMatch(/\.waterfall-decrease\s*{\s*fill:\s*var\(--view-mark-fall\)/);
    expect(css).toMatch(/\.cv-swatch--decrease\s*{\s*background:\s*var\(--view-mark-fall\)/);
    expect(theme).toMatch(/--view-mark-fall:\s*color-mix\(in srgb, var\(--color-text-success/);
    expect(css).not.toContain("--color-text-info");
  });

  // Owner decision 2026-11-10: at about 600 px the by-model table scrolled sideways and hid Price.
  it("drops costs A and B from the by-model table at 640 px, so Price fits at about 600 px", () => {
    const css = readFileSync(path.join(__dirname, "cost-change/cost-change.css"), "utf8");
    const at640 = /@media \(max-width: 640px\)\s*{([^@]*)}/.exec(css)?.[1] ?? "";
    expect(at640).toMatch(/\.view-table \.cv-col-wide\s*{\s*display:\s*none/);
    const at480 = /@media \(max-width: 480px\)\s*{([^@]*)}/.exec(css)?.[1] ?? "";
    expect(at480).not.toContain("cv-col-wide");
  });

  it("draws the waterfall with a written sign on every effect, so colour is never the only cue", () => {
    setup();
    const chart = screen.getByRole("img", { name: /usage \+50\.00, price −20\.00, mix \+10\.00/ });
    expect(chart.querySelector('[data-step="usage"]')).toHaveAttribute("data-kind", "increase");
    expect(chart.querySelector('[data-step="price"]')).toHaveAttribute("data-kind", "decrease");
    expect(within(chart).getByText("−20.00")).toBeInTheDocument();
    expect(within(chart).getByText("+50.00")).toBeInTheDocument();
    expect(screen.getByText(/The three add up to the change/)).toBeInTheDocument();
  });

  it("says 'no earlier figure' rather than a change from 0 when period A has nothing priced", () => {
    setup(ok(costVariance({ currencies: [varianceCurrency({ costA: 0, costB: 120, change: 120, usage: 120, price: 0, mix: 0, models: [] })] })));
    expect(within(screen.getByRole("group", { name: "2026-09 (A)" })).getByText("no earlier figure")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Change" })).getByText("no earlier figure")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /usage/ })).not.toBeInTheDocument();
    expect(screen.getByText(/2026-09 has no priced figure, so there is no change to break down/)).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Cost change in AI Credits" })).queryByText(/%/)).not.toBeInTheDocument();
  });

  it("keeps currencies apart, one block each", () => {
    setup(ok(costVariance({ currencies: [varianceCurrency(), varianceCurrency({ currency: "USD", costA: 1, costB: 2, change: 1, usage: 1, price: 0, mix: 0, models: [] })] })));
    expect(screen.getByRole("heading", { level: 2, name: "AI Credits" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "USD" })).toBeInTheDocument();
  });

  it("lists the not-explained turns per period with their reasons", () => {
    setup();
    const section = screen.getByRole("region", { name: "Not explained" });
    expect(within(section).getByText("2026-09: all turns explained")).toBeInTheDocument();
    expect(within(section).getByText("2026-10: 3 turns without a priced figure are not explained")).toBeInTheDocument();
    expect(within(section).getByText("no price for mystery-model")).toBeInTheDocument();
  });

  it("lists documented price changes, marked documented", () => {
    setup();
    const section = screen.getByRole("region", { name: "Documented price changes between the periods" });
    expect(within(section).getByText(/claude-sonnet-5\.5 · github-copilot · Oct 15/)).toBeInTheDocument();
    expect(within(section).getByText("documented")).toBeInTheDocument();
  });

  it("says so when no price changed", () => {
    setup(ok(costVariance({ priceChanges: [] })));
    expect(screen.getByText("No documented price change between the periods.")).toBeInTheDocument();
  });

  it("notes the conversion when figures were converted", () => {
    setup(ok(costVariance({ currency: "usd" })));
    expect(screen.getByText(/1 AI Credit = \$0\.01/)).toBeInTheDocument();
  });
});

describe("CostChangeView model table", () => {
  it("lists costs A and B, the change and the usage and price effects, collapsed", () => {
    setup();
    const table = screen.getByRole("table", { name: "Change by model, AI Credits" });
    const row = within(table).getByRole("button", { name: "claude-sonnet-5.5" }).closest("tr")!;
    for (const text of ["60.00 AI Credits", "100.00 AI Credits", "+40.00 AI Credits", "+30.00 AI Credits", "+10.00 AI Credits"]) expect(within(row).getByText(text)).toBeInTheDocument();
    expect(within(table).getByRole("button", { name: "claude-sonnet-5.5" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("uncached input")).not.toBeInTheDocument();
  });

  it("expands a model to token types with tokens, unit prices and price versions", () => {
    setup();
    const button = screen.getByRole("button", { name: "claude-sonnet-5.5" });
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const detail = screen.getByRole("table", { name: "claude-sonnet-5.5 by token type" });
    expect(within(detail).getByText("uncached input")).toBeInTheDocument();
    expect(within(detail).getByText("1 M → 1.5 M")).toBeInTheDocument();
    expect(within(detail).getByText("3.00 AI Credits / 1M → 4.00 AI Credits / 1M")).toBeInTheDocument();
    expect(within(detail).getByText("none → 5.00 AI Credits / 1M")).toBeInTheDocument();
    expect(screen.getByText("Price versions: v1 → v2")).toBeInTheDocument();
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("table", { name: "claude-sonnet-5.5 by token type" })).not.toBeInTheDocument();
  });

  it("opens and closes a row with Tab, Enter and Space alone", async () => {
    const user = userEvent.setup();
    setup();
    const first = screen.getByRole("button", { name: "claude-sonnet-5.5" });
    for (let i = 0; i < 20 && document.activeElement !== first; i += 1) await user.tab();
    expect(document.activeElement).toBe(first);
    await user.keyboard("{Enter}");
    expect(first).toHaveAttribute("aria-expanded", "true");
    await user.keyboard(" ");
    expect(first).toHaveAttribute("aria-expanded", "false");
  });
});

describe("CostChangeView price changes drill-down (U11 to U13)", () => {
  const withPrices = (result: ToolResult = ok(priceChangeList())) => {
    const port = new FakeAppHostPort();
    port.toolResults.set("get_price_changes", result);
    return port;
  };
  const toolCalls = (port: FakeAppHostPort) => port.calls.filter((call) => call.method === "callTool");

  it("is an enabled control that says which models it opens, with no call until it is used", () => {
    const { port } = setup();
    const button = screen.getByRole("button", { name: "Price changes" });
    expect(button).toBeEnabled();
    expect(screen.getByText(/claude-sonnet-5\.5/, { selector: ".cv-price-note *, .cv-price-note" })).toBeInTheDocument();
    expect(screen.queryByText(/not available yet/)).not.toBeInTheDocument();
    expect(port.calls).toEqual([]);
  });

  it("is absent when no model had a price effect", () => {
    setup(ok(costVariance({ currencies: [varianceCurrency({ models: [] })] })));
    expect(screen.queryByRole("button", { name: "Price changes" })).not.toBeInTheDocument();
  });

  it("calls get_price_changes once, for U11's whole period and nothing else, as a tool call and never a message", async () => {
    const port = withPrices();
    setup("default", port);
    fireEvent.click(screen.getByRole("button", { name: "Price changes" }));
    await screen.findByRole("heading", { level: 1, name: "Price changes behind the cost change" });
    expect(port.calls).toEqual([{ method: "callTool", args: ["get_price_changes", { since: "2026-09-01", until: "2026-10-31" }] }]);
    expect(port.calls.some((call) => call.method === "sendMessage")).toBe(false);
  });

  it("opens U13 in place: a kicker trail, a Back control, and only the models with the largest price effect", async () => {
    setup("default", withPrices());
    fireEvent.click(screen.getByRole("button", { name: "Price changes" }));
    expect(screen.getByRole("status")).toHaveTextContent("Loading price changes");
    await screen.findByText(/1 of 2 changes in the range/);
    expect(screen.getByText("AI Credits Analyzer · Cost change › Price changes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to cost change" })).toBeInTheDocument();
    expect(screen.getByText("Cost change / Price changes")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: /claude-sonnet-5\.5/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3, name: /gpt-5\.5/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Documented price changes between the periods" })).not.toBeInTheDocument();
  });

  it("goes back to U11 with no new call, and focus returns to the Price changes button", async () => {
    const port = withPrices();
    setup("default", port);
    fireEvent.click(screen.getByRole("button", { name: "Price changes" }));
    await screen.findByText(/1 of 2 changes in the range/);
    fireEvent.click(screen.getByRole("button", { name: "Back to cost change" }));
    expect(screen.getByRole("heading", { level: 1, name: "widgets" })).toBeInTheDocument();
    expect(toolCalls(port)).toHaveLength(1);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Price changes" }));
  });

  it("says what failed, keeps Back, and retries", async () => {
    const port = withPrices({ isError: true, errorText: "since: not a date" });
    setup("default", port);
    fireEvent.click(screen.getByRole("button", { name: "Price changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("since: not a date");
    expect(screen.getByRole("button", { name: "Back to cost change" })).toBeInTheDocument();
    port.toolResults.set("get_price_changes", ok(priceChangeList()));
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await screen.findByText(/1 of 2 changes in the range/);
    expect(toolCalls(port)).toHaveLength(2);
  });

  it("shows an unreadable result as the same error", async () => {
    setup("default", withPrices(ok({ nothing: true })));
    fireEvent.click(screen.getByRole("button", { name: "Price changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/get_price_changes call failed/);
  });
});

describe("CostChangeView states", () => {
  it("waits for the result", () => {
    setup("waiting");
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for the cost change…");
  });

  it("explains an error result in plain text, without calling the host", () => {
    const { port } = setup({ isError: true });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Couldn't explain the change.");
    expect(alert).toHaveTextContent("explain_cost_change returned an error");
    expect(port.calls).toEqual([]);
  });

  it("shows the tool's error text under the heading, as text and never markup", () => {
    const { container } = setup({ isError: true, errorText: "<img src=x onerror=alert(1)><b>bold</b> no month" });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Couldn't explain the change.");
    expect(alert).toHaveTextContent("<img src=x onerror=alert(1)><b>bold</b> no month");
    expect(alert).not.toHaveTextContent("explain_cost_change returned an error");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelectorAll("b")).toHaveLength(1); // the error box's own title
  });

  it("names today's prices on the period tiles when the result is repriced", () => {
    setup(ok({ ...mixed(), pricing: "today" }));
    expect(within(screen.getByRole("group", { name: "2026-09 (A)" })).getByText("priced, today's prices")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "2026-10 (B)" })).getByText("priced, today's prices")).toBeInTheDocument();
  });

  it("names prices as of use on the period tiles by default", () => {
    setup();
    expect(within(screen.getByRole("group", { name: "2026-09 (A)" })).getByText("priced, prices as of use")).toBeInTheDocument();
  });

  it("treats a result it cannot read as an error", () => {
    setup(ok({ nonsense: true }));
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't explain the change.");
  });
});

describe("CostChangeView security and accessibility", () => {
  // The Price changes control makes the view's one host call: a reviewed read
  // tool with two dates. Nothing logged (reasons, model names) is sent, and no
  // message goes to the model.
  it("every control reaches the host only as the one get_price_changes call with the period's dates; logged reasons never reach it", async () => {
    const port = new FakeAppHostPort();
    port.toolResults.set("get_price_changes", ok(priceChangeList()));
    setup("default", port);
    const pressed = await exerciseEveryControl(document.body, { skip: /Back to cost change/ });
    expect(pressed).toContain("button:claude-sonnet-5.5");
    expect(pressed).toContain("button:Price changes");
    expect(port.calls).toEqual([{ method: "callTool", args: ["get_price_changes", { since: "2026-09-01", until: "2026-10-31" }] }]);
    expect(JSON.stringify(port.calls)).not.toContain("mystery-model");
  });

  it("has no axe violations: loaded, expanded, table view, no earlier figure, error, waiting", async () => {
    const loaded = setup();
    expect(await axeViolations()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "claude-sonnet-5.5" }));
    fireEvent.click(screen.getAllByRole("button", { name: "View as table" })[0]!);
    expect(await axeViolations()).toEqual([]);
    loaded.unmount();
    const none = setup(ok(costVariance({ currencies: [varianceCurrency({ costA: 0, costB: 5, change: 5, usage: 5, price: 0, mix: 0, models: [] })] })));
    expect(await axeViolations()).toEqual([]);
    none.unmount();
    const err = setup({ isError: true });
    expect(await axeViolations()).toEqual([]);
    err.unmount();
    setup("waiting");
    expect(await axeViolations()).toEqual([]);
  });
});
