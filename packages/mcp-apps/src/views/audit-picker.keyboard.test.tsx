// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { ViewBrand } from "../brand/view-brand.js";
import type { ToolResult } from "../host/app-host-port.js";
import { FakeAppHostPort } from "../host/fake-app-host-port.js";
import { auditRollup } from "../view-models/audit-fixtures.js";
import { AuditView } from "./AuditView.js";
import { SessionPickerView } from "./SessionPickerView.js";

// A30: U5's Analyse works from the keyboard alone, and U4 (read-only) has no
// control a keyboard user could trip over.

const brand: ViewBrand = { productId: "vscode-extension", displayName: "AI Credits Analyzer", version: "0.8.0" };
const ok = (structuredContent: unknown): ToolResult => ({ structuredContent });

const list = {
  total: 2,
  sessions: [
    { id: "7f3a9c2e", title: "Refactor billing exporter", turnCount: 42, model: "claude-sonnet-5.5", repositoryKey: null, projectId: null },
    { id: "5b91d0c4", title: "Add retry to export job", turnCount: 31, model: "gpt-6.1-sol", repositoryKey: null, projectId: null },
  ],
};

async function tabTo(user: ReturnType<typeof userEvent.setup>, target: HTMLElement, limit = 20): Promise<void> {
  for (let presses = 0; presses < limit && document.activeElement !== target; presses += 1) await user.tab();
  expect(document.activeElement).toBe(target);
}

describe("U5 by keyboard", () => {
  it("Tab reaches a row's Analyse, Enter sends one message, and the button reads Sent and is skipped", async () => {
    const user = userEvent.setup();
    const port = new FakeAppHostPort();
    render(<SessionPickerView port={port} brand={brand} result={ok(list)} />);
    const first = screen.getByRole("button", { name: "Analyse session 7f3a9c2e" });
    await tabTo(user, first);
    await user.keyboard("{Enter}");
    expect(port.calls.filter((call) => call.method === "sendMessage").map((call) => call.args[0])).toEqual(["Analyse session 7f3a9c2e"]);
    const sent = await screen.findByRole("button", { name: "Sent: session 7f3a9c2e" });
    expect(sent).toBeDisabled();
    // The next Tab lands on the next row's button, not on the disabled one.
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Analyse session 5b91d0c4" }));
  });

  it("Space works too, and the row itself is not a control", async () => {
    const user = userEvent.setup();
    const port = new FakeAppHostPort();
    render(<SessionPickerView port={port} brand={brand} result={ok(list)} />);
    await tabTo(user, screen.getByRole("button", { name: "Analyse session 5b91d0c4" }), 3);
    await user.keyboard(" ");
    expect(await screen.findByRole("button", { name: "Sent: session 5b91d0c4" })).toBeDisabled();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });
});

describe("U4 by keyboard", () => {
  it("offers nothing to press but the chart's View as table: its table regions take focus", async () => {
    const user = userEvent.setup();
    render(<AuditView brand={brand} result={ok(auditRollup())} />);
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["View as table"]);
    const regions = screen.getAllByRole("region", { name: /scrollable$/ });
    for (const region of regions) await tabTo(user, region);
  });

  // A32: the per-day figures by keyboard, and focus stays on the toggle.
  it("View as table opens and closes the per-day table from the keyboard", async () => {
    const user = userEvent.setup();
    render(<AuditView brand={brand} result={ok(auditRollup())} />);
    const toggle = screen.getByRole("button", { name: "View as table" });
    await tabTo(user, toggle);
    await user.keyboard("{Enter}");
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await tabTo(user, screen.getByRole("region", { name: "Failed calls per day, scrollable" }));
    await user.tab({ shift: true });
    expect(toggle).toHaveFocus();
    await user.keyboard(" ");
    expect(screen.queryByRole("table", { name: "Failed calls per day" })).toBeNull();
  });
});
