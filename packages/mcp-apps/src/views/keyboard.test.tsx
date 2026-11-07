// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { ViewBrand } from "../brand/view-brand.js";
import type { ToolResult } from "../host/app-host-port.js";
import { FakeAppHostPort } from "../host/fake-app-host-port.js";
import { costRollup, sessionCost, turnSeries } from "../view-models/fixtures.js";
import { turnView } from "../view-models/turn-view-fixture.js";
import { CostRollupView } from "./CostRollupView.js";
import { FindingsView } from "./FindingsView.js";
import { SessionCostView } from "./SessionCostView.js";
import { findingsResult, SAMPLE_FINDINGS } from "./findings/fixtures.js";

// A14 (docs/plans/mcp-apps.md §7): every drill-down and filter works from
// the keyboard alone (Tab, Enter, Space, arrows), and focus lands somewhere
// sensible when the content under it is replaced.

const brand: ViewBrand = { productId: "vscode-extension", displayName: "AI Credits Analyzer", version: "0.4.0" };
const ok = (structuredContent: unknown): ToolResult => ({ structuredContent });

function port(): FakeAppHostPort {
  const fake = new FakeAppHostPort();
  fake.toolResults.set("get_turn_series", { structuredContent: turnSeries() });
  fake.toolResults.set("get_turn", { structuredContent: turnView() });
  fake.toolResults.set("get_session_cost", { structuredContent: sessionCost() });
  return fake;
}

// Tabs forward until `target` has focus; fails rather than looping forever.
async function tabTo(user: ReturnType<typeof userEvent.setup>, target: HTMLElement, limit = 40): Promise<void> {
  for (let presses = 0; presses < limit && document.activeElement !== target; presses += 1) await user.tab();
  expect(document.activeElement).toBe(target);
}

describe("U1 top turns by keyboard", () => {
  it("Tab reaches a top turn, Enter expands it, Space expands another, and Hide turn hands focus back", async () => {
    const user = userEvent.setup();
    render(<SessionCostView port={port()} brand={brand} result={ok(sessionCost())} />);
    await screen.findByRole("img", { name: /AI Credits per turn/ });

    const turn17 = screen.getByRole("button", { name: "Turn 17" });
    await tabTo(user, turn17);
    await user.keyboard("{Enter}");
    expect(await screen.findByText("Turn 17 · claude-sonnet-5.5")).toBeInTheDocument();
    expect(turn17).toHaveAttribute("aria-expanded", "true");

    const turn5 = screen.getByRole("button", { name: "Turn 5" });
    await tabTo(user, turn5);
    await user.keyboard(" ");
    expect(turn5).toHaveAttribute("aria-expanded", "true");

    const hide = screen.getAllByRole("button", { name: "Hide turn" })[0]!;
    hide.focus();
    await user.keyboard("{Enter}");
    expect(turn17).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(turn17);
  });
});

describe("U2 drill-down by keyboard", () => {
  it("Enter on a top session drills in with focus on Back, and Back returns focus to that session", async () => {
    const user = userEvent.setup();
    render(<CostRollupView port={port()} brand={brand} result={ok(costRollup())} />);

    const session = screen.getByRole("button", { name: "Refactor provider registry" });
    await tabTo(user, session);
    await user.keyboard("{Enter}");
    const back = await screen.findByRole("button", { name: "Back to cost rollup" });
    await waitFor(() => expect(document.activeElement).toBe(back));
    await screen.findByRole("button", { name: "Ask about this session" });
    // Loading the session must not steal focus from Back.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Back to cost rollup" }));

    await user.keyboard("{Enter}");
    const again = await screen.findByRole("button", { name: "Refactor provider registry" });
    expect(document.activeElement).toBe(again);
  });

  it("Space works too, and Back from a failed load still returns focus", async () => {
    const user = userEvent.setup();
    const fake = port();
    fake.toolResults.delete("get_session_cost");
    render(<CostRollupView port={fake} brand={brand} result={ok(costRollup())} />);
    await tabTo(user, screen.getByRole("button", { name: "Refactor provider registry" }));
    await user.keyboard(" ");
    await screen.findByRole("alert");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Back to cost rollup" }));
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Refactor provider registry" }));
  });
});

describe("U3 filters and evidence by keyboard", () => {
  it("Tab reaches the kind radios, arrows pick a kind, and the severity select takes the keyboard", async () => {
    const user = userEvent.setup();
    const fake = new FakeAppHostPort();
    fake.toolResults.set("list_findings", ok(findingsResult([SAMPLE_FINDINGS[0]!], { total: 1 })));
    render(<FindingsView brand={brand} port={fake} result={ok(findingsResult(SAMPLE_FINDINGS, { total: 3 }))} />);

    await tabTo(user, screen.getByRole("radio", { name: "All" }));
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Security" })).toBeChecked();
    await waitFor(() => expect(fake.calls.filter((c) => c.method === "callTool").map((c) => c.args)).toEqual([["list_findings", { kind: ["security"] }]]));

    const severity = screen.getByRole("combobox", { name: "Severity" });
    await user.tab();
    expect(document.activeElement).toBe(severity);
    // jsdom has no native select popup; a keyboard user changes it with the
    // arrows, which fire change, the same event this view listens to.
    await user.selectOptions(severity, "high");
    await waitFor(() => expect(fake.calls.filter((c) => c.method === "callTool")).toHaveLength(2));
    expect(fake.calls.at(-1)!.args).toEqual(["list_findings", { kind: ["security"], minSeverity: "high" }]);
  });

  it("Enter opens a finding's evidence and Enter closes it", async () => {
    const user = userEvent.setup();
    render(<FindingsView brand={brand} port={new FakeAppHostPort()} result={ok(findingsResult(SAMPLE_FINDINGS, { total: 3 }))} />);
    const toggle = screen.getByRole("button", { name: /Redacted evidence/ });
    await tabTo(user, toggle);
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("the findings table's scroll container is in the tab order", async () => {
    const user = userEvent.setup();
    render(<FindingsView brand={brand} port={new FakeAppHostPort()} result={ok(findingsResult(SAMPLE_FINDINGS, { total: 3 }))} />);
    await tabTo(user, screen.getByRole("region", { name: /Findings, scrollable/ }));
  });
});
