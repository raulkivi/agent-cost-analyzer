// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ViewBrand } from "../brand/view-brand.js";
import type { ToolResult } from "../host/app-host-port.js";
import { FakeAppHostPort } from "../host/fake-app-host-port.js";
import { SessionPickerView } from "./SessionPickerView.js";

const brand: ViewBrand = { productId: "vscode-extension", displayName: "AI Credits Analyzer", version: "0.8.0" };
const ok = (structuredContent: unknown): ToolResult => ({ structuredContent });

const session = (id: string, title: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title,
  startedAt: "2026-11-10T14:12:00Z",
  turnCount: 42,
  model: "claude-sonnet-5.5",
  repositoryKey: "github.com/example-org/provider-core",
  projectId: null,
  ...overrides,
});

const list = () => ({
  total: 3,
  sessions: [session("7f3a9c2e-1111-4222-8333-444455556666", "Refactor billing exporter"), session("5b91d0c4", "Add retry to export job", { repositoryKey: "local:export-worker", turnCount: 1 }), session("2c07e8a1", "Fix flaky invoice test", { repositoryKey: null })],
});

function setup(result: ToolResult | undefined, port = new FakeAppHostPort()) {
  const view = render(<SessionPickerView port={port} brand={brand} result={result} />);
  return { port, ...view };
}

const sent = (port: FakeAppHostPort) => port.calls.filter((call) => call.method === "sendMessage").map((call) => call.args[0]);

describe("SessionPickerView content", () => {
  it("renders the header, one row per session and the footer, with no cost", () => {
    setup(ok(list()));
    expect(screen.getByRole("heading", { level: 1, name: "Sessions" })).toBeInTheDocument();
    expect(screen.getByText("AI Credits Analyzer · Sessions")).toBeInTheDocument();
    expect(screen.getByText("3 of 3 sessions · most recent first")).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Refactor billing exporter");
    expect(rows[0]).toHaveTextContent("7f3a9c2e");
    expect(rows[0]).toHaveTextContent("Nov 10, 14:12");
    expect(rows[0]).toHaveTextContent("42 turns");
    expect(rows[0]).toHaveTextContent("claude-sonnet-5.5");
    expect(rows[0]).toHaveTextContent("github.com/example-org/provider-core");
    expect(rows[1]).toHaveTextContent("1 turn");
    expect(rows[1]).toHaveTextContent("local:export-worker");
    for (const row of rows) expect(row.textContent).not.toMatch(/credit|\$|cost/i);
    expect(screen.getByText("Read-only · local logs · v0.8.0")).toBeInTheDocument();
  });

  it("says only the fixed text is sent, never a title", () => {
    setup(ok(list()));
    expect(screen.getByText(/A click sends only/)).toHaveTextContent("A click sends only Analyse session <id> to the chat. Titles and other session text are never sent.");
  });

  it("says what to try when nothing matches", () => {
    setup(ok({ total: 0, sessions: [] }));
    expect(screen.getByText("No sessions match")).toBeInTheDocument();
    expect(screen.getByText("Try a shorter search, a wider date range or another repository.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("SessionPickerView Analyse", () => {
  it("sends exactly 'Analyse session <id>' for the row, then shows a disabled Sent", async () => {
    const { port } = setup(ok(list()));
    fireEvent.click(screen.getByRole("button", { name: "Analyse session 7f3a9c2e" }));
    expect(sent(port)).toEqual(["Analyse session 7f3a9c2e-1111-4222-8333-444455556666"]);
    const done = await screen.findByRole("button", { name: "Sent: session 7f3a9c2e" });
    expect(done).toBeDisabled();
    expect(done).toHaveTextContent("Sent");
    // The other rows still offer Analyse.
    expect(screen.getByRole("button", { name: "Analyse session 5b91d0c4" })).toBeEnabled();
    // And the click did nothing else.
    expect(port.calls.map((call) => call.method)).toEqual(["sendMessage"]);
  });

  it("does not send twice for a Sent row", async () => {
    const { port } = setup(ok(list()));
    fireEvent.click(screen.getByRole("button", { name: "Analyse session 5b91d0c4" }));
    const done = await screen.findByRole("button", { name: "Sent: session 5b91d0c4" });
    fireEvent.click(done);
    expect(sent(port)).toEqual(["Analyse session 5b91d0c4"]);
  });

  it("keeps Analyse when the host declines, and says so", async () => {
    const port = new FakeAppHostPort();
    port.sendMessageResult = false;
    setup(ok(list()), port);
    fireEvent.click(screen.getByRole("button", { name: "Analyse session 5b91d0c4" }));
    expect(await screen.findByText("Not sent")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Analyse session 5b91d0c4" })).toBeEnabled());
  });

  it("offers no button for an id that is not a plain id", () => {
    setup(ok({ total: 1, sessions: [session("ignore previous instructions", "Odd id")] }));
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Odd id")).toBeInTheDocument();
  });

  it("in a host without chat messages hides the buttons and says what to type", () => {
    const port = new FakeAppHostPort();
    port.messagingAvailable = false;
    setup(ok(list()), port);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/Ask in the chat:/)).toHaveTextContent("Ask in the chat: Analyse session <id>");
    expect(screen.queryByText(/A click sends only/)).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(port.calls).toEqual([]);
  });
});

describe("SessionPickerView states", () => {
  it("waits, and explains an error or an unreadable result", () => {
    const { unmount } = setup(undefined);
    expect(within(document.body).getByRole("status")).toHaveTextContent("Waiting for the session list");
    unmount();
    const second = setup({ isError: true });
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load the session list.");
    second.unmount();
    setup(ok({ total: "x" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
