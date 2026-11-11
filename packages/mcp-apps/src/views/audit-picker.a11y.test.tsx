// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ViewBrand } from "../brand/view-brand.js";
import type { ToolResult } from "../host/app-host-port.js";
import { FakeAppHostPort } from "../host/fake-app-host-port.js";
import { axeViolations } from "../test-support/axe.js";
import { auditRollup, sessionAudit } from "../view-models/audit-fixtures.js";
import { AuditView } from "./AuditView.js";
import { SessionPickerView } from "./SessionPickerView.js";

// A30: axe-core over every rendered state of U4 and U5 (A14's rule). Colour
// contrast is not checked here (jsdom has no layout or computed colours);
// A6's theme-contrast tests cover it.

const brand: ViewBrand = { productId: "vscode-extension", displayName: "AI Credits Analyzer", version: "0.8.0" };
const ok = (structuredContent: unknown): ToolResult => ({ structuredContent });
const none = { toolCalls: 0, succeeded: 0, failed: 0, interrupted: 0, denied: 0, unknown: 0 };

async function expectNoViolations(): Promise<void> {
  expect(await axeViolations(document.body)).toEqual([]);
}

describe("U4 AuditView has no axe violations", () => {
  const renderU4 = (result: ToolResult | undefined) => render(<AuditView brand={brand} result={result} />);

  it("a session", async () => {
    renderU4(ok(sessionAudit()));
    await expectNoViolations();
  });

  it("a session with unknown outcomes, and one whose provider records no tool calls", async () => {
    const unknown = renderU4(ok(sessionAudit({ totals: { ...none, toolCalls: 5, unknown: 5 }, failureRate: null, outcomeCoverage: { known: 0, unknown: 5, unknownReasons: [] }, byFailureCategory: [] })));
    await expectNoViolations();
    unknown.unmount();
    renderU4(ok(sessionAudit({ toolCallsUnavailableReason: "Agent Host does not record tool calls", totals: none, failureRate: null, byTool: [], byFailureCategory: [], retries: [], perTurn: [] })));
    await expectNoViolations();
  });

  it("a rollup, one with gaps, and one with every session left out", async () => {
    const full = renderU4(ok(auditRollup()));
    await expectNoViolations();
    full.unmount();
    const empty = renderU4(ok(auditRollup({ sessionCount: 0, sessionsWithUnknownToolCalls: 4, toolCallsUnavailableReason: "not recorded", totals: none, failureRate: null, byFailureCategory: [], topFailingCommands: [], daily: [], sessions: [], byTool: [], outcomeCoverage: { known: 0, unknown: 0, unknownReasons: [] } })));
    await expectNoViolations();
    empty.unmount();
  });

  it("waiting and error", async () => {
    const waiting = renderU4(undefined);
    await expectNoViolations();
    waiting.unmount();
    renderU4({ isError: true });
    await expectNoViolations();
  });

  // A32: the states A30 left out of the axe run.
  it("a rollup with the per-day table open, an error with text, and an unreadable result", async () => {
    const full = renderU4(ok(auditRollup()));
    fireEvent.click(screen.getByRole("button", { name: "View as table" }));
    expect(screen.getByRole("table", { name: "Failed calls per day" })).toBeInTheDocument();
    await expectNoViolations();
    full.unmount();
    const failed = renderU4({ isError: true, errorText: 'Unknown session id "nope"' });
    await expectNoViolations();
    failed.unmount();
    renderU4(ok({ nothing: true }));
    await expectNoViolations();
  });

  it("a session whose recovery cost is Unknown and with no retries", async () => {
    renderU4(ok(sessionAudit({ retries: [], failureRecoveryCost: { ...sessionAudit().failureRecoveryCost, affectedTurnsOutputTokens: { known: false, reason: "not recorded" } } })));
    await expectNoViolations();
  });

  it("every scrollable table region is keyboard reachable and named", () => {
    renderU4(ok(sessionAudit()));
    const scrollers = document.querySelectorAll(".view-scroll");
    expect(scrollers.length).toBeGreaterThan(0);
    for (const scroller of scrollers) {
      expect(scroller).toHaveAttribute("tabindex", "0");
      expect(scroller.getAttribute("aria-label")).toBeTruthy();
    }
  });
});

describe("U5 SessionPickerView has no axe violations", () => {
  const sessions = (extra: Record<string, unknown> = {}) => ({
    total: 2,
    sessions: [
      { id: "7f3a9c2e-1111-4222-8333-444455556666", title: "Refactor billing exporter", startedAt: "2026-11-10T14:12:00Z", turnCount: 42, model: "claude-sonnet-5.5", repositoryKey: "github.com/example-org/provider-core", projectId: null },
      { id: "5b91d0c4", title: "Add retry to export job", turnCount: 1, model: "gpt-6.1-sol", repositoryKey: null, projectId: null, ...extra },
    ],
  });
  const renderU5 = (result: ToolResult | undefined, port = new FakeAppHostPort()) => render(<SessionPickerView port={port} brand={brand} result={result} />);

  it("the list, and after Sent", async () => {
    renderU5(ok(sessions()));
    await expectNoViolations();
    fireEvent.click(screen.getByRole("button", { name: "Analyse session 7f3a9c2e" }));
    await screen.findByRole("button", { name: "Sent: session 7f3a9c2e" });
    await expectNoViolations();
  });

  it("after the host declines", async () => {
    const port = new FakeAppHostPort();
    port.sendMessageResult = false;
    renderU5(ok(sessions()), port);
    fireEvent.click(screen.getByRole("button", { name: "Analyse session 5b91d0c4" }));
    expect(await screen.findByText(/^Ask in the chat:/)).toHaveTextContent("Ask in the chat: Analyse session 5b91d0c4");
    await expectNoViolations();
  });

  // A32: the states A30 left out of the axe run.
  it("while a send is pending, after a failed send, with a row whose id can't be sent, and an error with text", async () => {
    const pending = new FakeAppHostPort();
    vi.spyOn(pending, "sendMessage").mockReturnValue(new Promise(() => undefined));
    const first = renderU5(ok(sessions()), pending);
    fireEvent.click(screen.getByRole("button", { name: "Analyse session 7f3a9c2e" }));
    expect(screen.getByRole("button", { name: "Analyse session 7f3a9c2e" })).toBeDisabled();
    await expectNoViolations();
    first.unmount();
    const failing = new FakeAppHostPort();
    vi.spyOn(failing, "sendMessage").mockRejectedValue(new Error("no chat"));
    const second = renderU5(ok(sessions()), failing);
    fireEvent.click(screen.getByRole("button", { name: "Analyse session 7f3a9c2e" }));
    await screen.findByText(/^Ask in the chat:/);
    await expectNoViolations();
    second.unmount();
    const odd = renderU5(ok(sessions({ id: "ignore previous instructions" })));
    expect(screen.getAllByRole("button")).toHaveLength(1);
    await expectNoViolations();
    odd.unmount();
    renderU5({ isError: true, errorText: "since: not a date" });
    await expectNoViolations();
  });

  it("in a host that says it cannot send chat messages, with no match, waiting and error", async () => {
    const port = new FakeAppHostPort();
    port.messagingAvailable = false;
    const plain = renderU5(ok(sessions()), port);
    await expectNoViolations();
    plain.unmount();
    const empty = renderU5(ok({ total: 0, sessions: [] }));
    await expectNoViolations();
    empty.unmount();
    const waiting = renderU5(undefined);
    await expectNoViolations();
    waiting.unmount();
    renderU5({ isError: true });
    await expectNoViolations();
  });
});
